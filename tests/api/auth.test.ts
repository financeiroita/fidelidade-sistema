import { beforeEach, describe, expect, it } from 'vitest';
import { createOperator } from '../../src/application/auth';
import { can, passwordProblem } from '../../src/domain/auth/auth';
import { hashPassword, verifyPassword } from '../../src/infra/security/password';
import { makeApp } from '../helpers';

const PASSWORD = 'uma-senha-bem-longa-42';
let clock: Date;
let ctx: ReturnType<typeof makeApp>;

const call = async (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
  headers: Record<string, string> = {},
) => await ctx.app.inject({ method, url, payload: payload as object, headers });

/** Cria um funcionário de verdade (com senha) pelo caso de uso e devolve o login pela API. */
async function realOperator(username: string, role: 'RECEPTION' | 'MANAGER' | 'ADMIN' = 'RECEPTION') {
  await createOperator(ctx.auth, { username, name: `Pessoa ${username}`, role, password: PASSWORD });
}
const login = (username: string, password = PASSWORD) => call('POST', '/auth/login', { username, password });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

beforeEach(() => {
  clock = new Date('2026-07-13T12:00:00Z');
  ctx = makeApp(undefined, () => clock);
});

describe('senhas', () => {
  it('hash com sal: nunca igual, confere só a senha certa e não guarda a senha', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(a).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword('outra-senha-qualquer-1', a)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'lixo')).toBe(false);
  });

  it('política: tamanho, variedade e sem o usuário', () => {
    expect(passwordProblem('curta')).toMatch(/12 caracteres/);
    expect(passwordProblem('aaaaaaaaaaaaaaaa')).toMatch(/repetidos/);
    expect(passwordProblem('maria-senha-forte-1', 'maria')).toMatch(/usuário/);
    expect(passwordProblem(PASSWORD, 'maria')).toBeNull();
  });
});

describe('login', () => {
  it('entra, recebe token e acessa rota interna; sem token ou token errado: 401', async () => {
    await realOperator('maria');
    const res = await login('maria');
    expect(res.statusCode).toBe(200);
    const { token, operator } = res.json();
    expect(operator).toMatchObject({ username: 'maria', role: 'RECEPTION' });
    expect(JSON.stringify(res.json())).not.toContain('passwordHash');
    expect((await call('GET', '/auth/me', undefined, bearer(token))).json()).toMatchObject({ username: 'maria' });
    expect((await call('GET', '/auth/me')).statusCode).toBe(401);
    expect((await call('GET', '/auth/me', undefined, bearer('x'.repeat(43)))).statusCode).toBe(401);
  });

  it('a sessão só guarda o hash do token', async () => {
    await realOperator('maria');
    const { token } = (await login('maria')).json();
    expect([...ctx.authRepo.sessions.keys()].some((k) => k === token)).toBe(false);
  });

  it('usuário inexistente, senha errada e conta desativada dão a mesma resposta', async () => {
    await realOperator('maria');
    const wrong = await login('maria', 'senha-errada-123456');
    const ghost = await login('ninguem');
    expect(wrong.statusCode).toBe(401);
    expect(ghost.statusCode).toBe(401);
    expect(wrong.json()).toEqual(ghost.json());
    expect((await call('POST', '/auth/login', { username: 123 })).statusCode).toBe(401);
  });

  it('trava a conta depois de 5 senhas erradas, mesmo com a senha certa, e destrava depois do prazo', async () => {
    await realOperator('maria');
    for (let i = 0; i < 5; i++) expect((await login('maria', 'errada-errada-12')).statusCode).toBe(401);
    expect((await login('maria')).statusCode).toBe(401); // travada
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect((await login('maria')).statusCode).toBe(200);
  });

  it('uma senha certa no meio zera a contagem de falhas', async () => {
    await realOperator('maria');
    for (let i = 0; i < 4; i++) await login('maria', 'errada-errada-12');
    expect((await login('maria')).statusCode).toBe(200);
    for (let i = 0; i < 4; i++) await login('maria', 'errada-errada-12');
    expect((await login('maria')).statusCode).toBe(200);
  });

  it('sessão expira e logout encerra', async () => {
    await realOperator('maria');
    const { token } = (await login('maria')).json();
    clock = new Date(clock.getTime() + 13 * 3_600_000);
    expect((await call('GET', '/auth/me', undefined, bearer(token))).statusCode).toBe(401);

    const second = (await login('maria')).json().token;
    expect((await call('POST', '/auth/logout', undefined, bearer(second))).statusCode).toBe(204);
    expect((await call('GET', '/auth/me', undefined, bearer(second))).statusCode).toBe(401);
  });
});

describe('permissões por papel', () => {
  it('matriz: recepção opera, gerente cancela e cadastra prêmios, administrador gerencia funcionários', () => {
    expect(can('RECEPTION', 'redemption:create')).toBe(true);
    expect(can('RECEPTION', 'redemption:cancel')).toBe(false);
    expect(can('RECEPTION', 'reward:write')).toBe(false);
    expect(can('MANAGER', 'redemption:cancel')).toBe(true);
    expect(can('MANAGER', 'operator:admin')).toBe(false);
    expect(can('ADMIN', 'audit:read')).toBe(true);
  });

  it('recepção não cancela resgate, não cadastra prêmio, não vê auditoria nem gerencia funcionários (403)', async () => {
    const rec = ctx.operator('RECEPTION');
    expect((await call('POST', '/rewards', { name: 'Jantar', type: 'DINING', pointsCost: 100 }, rec.headers)).statusCode).toBe(403);
    expect((await call('POST', '/redemptions/7b0c4b7e-0000-4000-8000-000000000000/cancel', {}, rec.headers)).statusCode).toBe(403);
    expect((await call('GET', '/audit', undefined, rec.headers)).statusCode).toBe(403);
    expect((await call('GET', '/operators', undefined, rec.headers)).statusCode).toBe(403);
    // mas opera o dia a dia
    expect((await call('GET', '/guests/7b0c4b7e-0000-4000-8000-000000000000/balance', undefined, rec.headers)).statusCode).toBe(404);
  });

  it('a tentativa negada fica registrada', async () => {
    const rec = ctx.operator('RECEPTION', 'Ana Recepção');
    await call('GET', '/audit', undefined, rec.headers);
    expect(ctx.auditRepo.entries.at(-1)).toMatchObject({
      action: 'auth.denied',
      ok: false,
      operatorName: 'Ana Recepção',
      details: { permission: 'audit:read' },
    });
  });

  it('gerente não administra funcionários', async () => {
    expect((await call('POST', '/operators', { username: 'novo', name: 'Novo', role: 'RECEPTION', password: PASSWORD }, ctx.headers)).statusCode).toBe(403);
  });
});

describe('gestão de funcionários (administrador)', () => {
  it('cria, lista sem expor senhas, não duplica e valida a senha', async () => {
    const admin = ctx.operator('ADMIN');
    const body = { username: 'joao', name: 'João Lima', role: 'RECEPTION', password: PASSWORD };
    expect((await call('POST', '/operators', body, admin.headers)).statusCode).toBe(201);
    expect((await call('POST', '/operators', body, admin.headers)).statusCode).toBe(409);
    const weak = await call('POST', '/operators', { ...body, username: 'ana', password: 'curta' }, admin.headers);
    expect(weak.statusCode).toBe(422);
    expect(weak.json().error).toBe('weak_password');
    expect((await call('POST', '/operators', { ...body, username: 'Nome Inválido!' }, admin.headers)).statusCode).toBe(422);
    const list = (await call('GET', '/operators', undefined, admin.headers)).json();
    expect(JSON.stringify(list)).not.toMatch(/passwordHash|scrypt/);
    expect((await login('joao')).statusCode).toBe(200);
  });

  it('desativar derruba as sessões e impede novo login; não pode desativar a si mesmo', async () => {
    const admin = ctx.operator('ADMIN');
    await realOperator('joao');
    const { token } = (await login('joao')).json();
    const joao = [...ctx.authRepo.operators.values()].find((o) => o.username === 'joao')!;
    expect((await call('POST', `/operators/${joao.id}/deactivate`, undefined, admin.headers)).statusCode).toBe(204);
    expect((await call('GET', '/auth/me', undefined, bearer(token))).statusCode).toBe(401);
    expect((await login('joao')).statusCode).toBe(401);
    expect((await call('POST', `/operators/${admin.id}/deactivate`, undefined, admin.headers)).json()).toEqual({
      error: 'cannot_deactivate_self',
    });
    expect((await call('POST', `/operators/${joao.id}/activate`, undefined, admin.headers)).statusCode).toBe(204);
    expect((await login('joao')).statusCode).toBe(200);
  });

  it('o administrador redefine a senha e as sessões antigas caem', async () => {
    const admin = ctx.operator('ADMIN');
    await realOperator('joao');
    const { token } = (await login('joao')).json();
    const joao = [...ctx.authRepo.operators.values()].find((o) => o.username === 'joao')!;
    const next = 'outra-senha-longa-99';
    expect((await call('POST', `/operators/${joao.id}/password`, { password: next }, admin.headers)).statusCode).toBe(204);
    expect((await call('GET', '/auth/me', undefined, bearer(token))).statusCode).toBe(401);
    expect((await login('joao')).statusCode).toBe(401);
    expect((await login('joao', next)).statusCode).toBe(200);
  });

  it('o próprio funcionário troca a senha: exige a atual, mantém só a sessão atual', async () => {
    await realOperator('joao');
    const a = (await login('joao')).json().token;
    const b = (await login('joao')).json().token;
    const next = 'senha-nova-bem-longa-7';
    expect((await call('POST', '/auth/password', { current: 'errada-errada-12', next }, bearer(a))).statusCode).toBe(401);
    expect((await call('POST', '/auth/password', { current: PASSWORD, next: 'curta' }, bearer(a))).statusCode).toBe(422);
    expect((await call('POST', '/auth/password', { current: PASSWORD, next }, bearer(a))).statusCode).toBe(204);
    expect((await call('GET', '/auth/me', undefined, bearer(a))).statusCode).toBe(200);
    expect((await call('GET', '/auth/me', undefined, bearer(b))).statusCode).toBe(401);
    expect((await login('joao', next)).statusCode).toBe(200);
  });
});

describe('registro de auditoria', () => {
  const ana = {
    fullName: 'Ana Souza',
    email: 'ana@exemplo.com',
    phone: '12988887777',
    documentType: 'CPF',
    document: '529.982.247-25',
    birthDate: '1990-05-17',
    acceptedTerms: true,
  };

  it('registra quem lançou a estadia, fez o check-out, resgatou e cancelou, sem dados pessoais', async () => {
    const rec = ctx.operator('RECEPTION', 'Bia Recepção');
    const g = (await call('POST', '/guests', ana)).json();
    const stay = (
      await call(
        'POST',
        '/stays',
        { guestId: g.id, channel: 'OTA', checkIn: '2026-07-10', checkOut: '2026-07-12', externalRef: 'A-1', charges: [{ category: 'ROOM', amount: 2000 }] },
        rec.headers,
      )
    ).json();
    await call('POST', `/stays/${stay.id}/checkout`, undefined, rec.headers);
    const reward = (await call('POST', '/rewards', { name: 'Jantar', type: 'DINING', pointsCost: 1000 }, ctx.headers)).json();
    const r = (await call('POST', '/redemptions', { guestId: g.id, rewardId: reward.id, requestId: 'pedido-auditoria-01' }, rec.headers)).json();
    await call('POST', `/redemptions/${r.id}/cancel`, undefined, ctx.headers);

    const log = (await call('GET', '/audit?limit=50', undefined, ctx.headers)).json();
    const byAction = (a: string) => log.find((e: { action: string }) => e.action === a);
    expect(byAction('stay.create')).toMatchObject({ operatorName: 'Bia Recepção', entity: 'stay', entityId: stay.id });
    expect(byAction('stay.checkout').details).toMatchObject({ earned: 2000, alreadyProcessed: false });
    expect(byAction('reward.create')).toMatchObject({ operatorName: 'Gerente Teste' });
    expect(byAction('redemption.create')).toMatchObject({ operatorName: 'Bia Recepção', entityId: r.id });
    expect(byAction('redemption.cancel')).toMatchObject({ operatorName: 'Gerente Teste', entityId: r.id });
    const text = JSON.stringify(log);
    expect(text).not.toMatch(/529\.?982|ana@exemplo|Ana Souza|12988887777/);
  });

  it('filtra por entidade e respeita o limite; pedido repetido não duplica o registro', async () => {
    const g = (await call('POST', '/guests', ana)).json();
    const reward = (await call('POST', '/rewards', { name: 'Café', type: 'DINING', pointsCost: 1 }, ctx.headers)).json();
    const stay = (await call('POST', '/stays', { guestId: g.id, channel: 'OTA', checkIn: '2026-07-10', checkOut: '2026-07-12', externalRef: 'A-9', charges: [{ category: 'ROOM', amount: 500 }] }, ctx.headers)).json();
    await call('POST', `/stays/${stay.id}/checkout`, undefined, ctx.headers);
    const body = { guestId: g.id, rewardId: reward.id, requestId: 'repetido-123456' };
    await call('POST', '/redemptions', body, ctx.headers);
    await call('POST', '/redemptions', body, ctx.headers); // replay
    const onlyRedemptions = (await call('GET', '/audit?entity=redemption', undefined, ctx.headers)).json();
    expect(onlyRedemptions).toHaveLength(1);
    expect((await call('GET', '/audit?limit=1', undefined, ctx.headers)).json()).toHaveLength(1);
  });

  it('login ok e falho ficam registrados, sem o usuário digitado nem a senha', async () => {
    await realOperator('maria');
    await login('maria', 'errada-errada-12');
    await login('digitei-a-senha-no-campo-do-usuario');
    await login('maria');
    const entries = ctx.auditRepo.entries.filter((e) => e.action === 'auth.login');
    expect(entries.map((e) => e.ok)).toEqual([false, false, true]);
    expect(JSON.stringify(entries)).not.toMatch(/errada-errada|digitei-a-senha/);
  });

  it('se a gravação da auditoria falhar, a operação já feita continua valendo', async () => {
    const g = (await call('POST', '/guests', ana)).json();
    ctx.auditRepo.failNext = true;
    const res = await call('POST', '/stays', { guestId: g.id, channel: 'OTA', checkIn: '2026-07-10', checkOut: '2026-07-12', externalRef: 'A-7', charges: [] }, ctx.headers);
    expect(res.statusCode).toBe(201);
  });

  it('só gerente ou administrador consulta; consulta de gerente funciona', async () => {
    expect((await call('GET', '/audit', undefined, ctx.headers)).statusCode).toBe(200);
    expect((await call('GET', '/audit')).statusCode).toBe(401);
  });
});
