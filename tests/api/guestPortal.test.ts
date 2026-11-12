import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app';
import { runNightly } from '../../src/application/maintenance';
import { InMemoryMaintenanceRepository } from '../../src/infra/memory/maintenanceRepository';
import { InMemoryAuditRepository, InMemoryAuthRepository } from '../../src/infra/memory/authRepository';
import { InMemoryGuestPortalRepository } from '../../src/infra/memory/guestPortalRepository';
import { InMemoryGuestRepository } from '../../src/infra/memory/guestRepository';
import { InMemoryRewardRepository } from '../../src/infra/memory/rewardRepository';
import { InMemoryStayRepository } from '../../src/infra/memory/stayRepository';
import { makeApp, SECRET } from '../helpers';

const ana = {
  fullName: 'Ana Souza',
  email: 'ana@exemplo.com',
  phone: '12988887777',
  documentType: 'CPF',
  document: '529.982.247-25',
  birthDate: '1990-05-17',
  acceptedTerms: true,
};
const bia = { ...ana, fullName: 'Bia Lima', email: 'bia@exemplo.com', document: '111.444.777-35' };

let clock: Date;
let ctx: ReturnType<typeof makeApp>;
let seq = 0;

const post = async (url: string, payload?: object, headers: Record<string, string> = {}) => {
  const r = await ctx.app.inject({ method: 'POST', url, payload: payload as object, headers });
  if (url === '/me/login/request') await ctx.flush(); // o pedido segue em segundo plano
  return r;
};
const get = (url: string, headers: Record<string, string> = {}) => ctx.app.inject({ method: 'GET', url, headers });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const signup = async (body: object) => (await post('/guests', body)).json() as { id: string; referralCode: string };

async function earn(guestId: string, amount: number) {
  const day = clock.toISOString().slice(0, 10);
  const prev = new Date(clock.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const s = await post(
    '/stays',
    { guestId, channel: 'OTA', checkIn: prev, checkOut: day, externalRef: `P-${++seq}`, charges: [{ category: 'ROOM', amount }] },
    ctx.headers,
  );
  await post(`/stays/${s.json().id}/checkout`, undefined, ctx.headers);
}

const lastCode = () => ctx.sent[ctx.sent.length - 1].code;

/** Pede o código e entra; devolve o token do hóspede. */
async function signIn(email: string) {
  expect((await post('/me/login/request', { email })).statusCode).toBe(202);
  const r = await post('/me/login/verify', { email, code: lastCode() });
  expect(r.statusCode).toBe(200);
  return r.json().token as string;
}

beforeEach(() => {
  clock = new Date('2026-03-01T12:00:00Z');
  ctx = makeApp(undefined, () => clock);
});

describe('entrar com código por e-mail', () => {
  it('fluxo completo: pede o código, entra e vê só os próprios dados', async () => {
    const g = await signup(ana);
    await earn(g.id, 3500);
    const token = await signIn('ANA@exemplo.com '); // maiúsculas e espaço não atrapalham
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0].email).toBe('ana@exemplo.com');
    expect(ctx.sent[0].code).toMatch(/^\d{6}$/);

    const me = (await get('/me', bearer(token))).json();
    expect(me).toMatchObject({
      firstName: 'Ana',
      referralCode: g.referralCode,
      memberSince: '2026-03-01',
      points: { available: 3500, pendingWelcome: 0 },
      tier: { name: 'Prata', validUntil: '2027-03-01' },
      progress: { qualifyingPts: 3500, currentMin: 3000, nextTier: { name: 'Ouro', missing: 4500 } },
      expiring: [{ date: '2028-03-01', points: 3500 }],
    });
    // Nada de documento, e-mail, telefone ou id interno na resposta.
    const raw = JSON.stringify(me);
    expect(raw).not.toContain('529');
    expect(raw).not.toContain('@');
    expect(raw).not.toContain(g.id);

    const st = (await get('/me/statement', bearer(token))).json();
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ type: 'EARN_STAY', points: 3500 });
  });

  it('e-mail sem cadastro: mesma resposta, nada é enviado', async () => {
    await signup(ana);
    const r = await post('/me/login/request', { email: 'ninguem@exemplo.com' });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual((await post('/me/login/request', { email: 'ana@exemplo.com' })).json());
    expect(ctx.sent.map((s) => s.email)).toEqual(['ana@exemplo.com']);
  });

  it('código errado 5 vezes queima o código: nem o certo vale depois', async () => {
    await signup(ana);
    await post('/me/login/request', { email: ana.email });
    const right = lastCode();
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await post('/me/login/verify', { email: ana.email, code: wrong })).statusCode).toBe(401);
    }
    const r = await post('/me/login/verify', { email: ana.email, code: right });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: 'invalid_code' });
  });

  it('o código vale 10 minutos e uma vez só', async () => {
    await signup(ana);
    await post('/me/login/request', { email: ana.email });
    const code = lastCode();
    clock = new Date(clock.getTime() + 10 * 60_000 + 1);
    expect((await post('/me/login/verify', { email: ana.email, code })).statusCode).toBe(401);

    await post('/me/login/request', { email: ana.email });
    const fresh = lastCode();
    expect((await post('/me/login/verify', { email: ana.email, code: fresh })).statusCode).toBe(200);
    expect((await post('/me/login/verify', { email: ana.email, code: fresh })).statusCode).toBe(401);
  });

  it('no máximo 3 pedidos a cada 15 minutos e 10 por dia', async () => {
    await signup(ana);
    for (let i = 0; i < 4; i++) expect((await post('/me/login/request', { email: ana.email })).statusCode).toBe(202);
    expect(ctx.sent).toHaveLength(3); // o 4º pedido é ignorado sem avisar
    for (let i = 0; i < 6; i++) {
      clock = new Date(clock.getTime() + 15 * 60_000 + 1);
      await post('/me/login/request', { email: ana.email });
      await post('/me/login/request', { email: ana.email });
    }
    expect(ctx.sent).toHaveLength(10); // teto do dia
    clock = new Date(clock.getTime() + 24 * 3_600_000);
    await post('/me/login/request', { email: ana.email });
    expect(ctx.sent).toHaveLength(11);
  });

  it('pedir de novo (ou outra pessoa pedir) não invalida o código que o hóspede já recebeu (ADR 0014)', async () => {
    await signup(ana);
    await post('/me/login/request', { email: ana.email });
    const mine = lastCode();
    await post('/me/login/request', { email: ana.email }); // ex.: alguém pedindo o código da Ana
    expect((await post('/me/login/verify', { email: ana.email, code: mine })).statusCode).toBe(200);
    // Depois de entrar, os outros códigos daquele momento deixam de valer.
    expect((await post('/me/login/verify', { email: ana.email, code: lastCode() })).statusCode).toBe(401);
  });

  it('10 erros em 24 horas, somando todos os códigos, bloqueiam o acesso pela internet até completar 24 h (ADR 0014)', async () => {
    await signup(ana);
    const wrongFor = (c: string) => (c === '000000' ? '111111' : '000000');
    for (let round = 0; round < 2; round++) {
      await post('/me/login/request', { email: ana.email });
      for (let i = 0; i < 5; i++) await post('/me/login/verify', { email: ana.email, code: wrongFor(lastCode()) });
    }
    clock = new Date(clock.getTime() + 20 * 60_000);
    const before = ctx.sent.length;
    await post('/me/login/request', { email: ana.email });
    expect(ctx.sent).toHaveLength(before); // bloqueado: nem recebe código novo
    expect((await post('/me/login/verify', { email: ana.email, code: lastCode() })).statusCode).toBe(401);
    clock = new Date(clock.getTime() + 24 * 3_600_000);
    await post('/me/login/request', { email: ana.email });
    expect((await post('/me/login/verify', { email: ana.email, code: lastCode() })).statusCode).toBe(200);
  });

  it('o código de um hóspede não serve para o e-mail de outro', async () => {
    await signup(ana);
    await signup(bia);
    await post('/me/login/request', { email: ana.email });
    expect((await post('/me/login/verify', { email: bia.email, code: lastCode() })).statusCode).toBe(401);
  });

  it('hóspede excluído (LGPD) não recebe código e a sessão dele para de valer', async () => {
    const g = await signup(ana);
    const token = await signIn(ana.email);
    ctx.guests.guests.find((x) => x.id === g.id)!.deletedAt = clock;
    expect((await get('/me', bearer(token))).statusCode).toBe(401);
    await post('/me/login/request', { email: ana.email });
    expect(ctx.sent).toHaveLength(1);
  });

  it('pedido malformado: e-mail inválido 422, código malformado 401', async () => {
    expect((await post('/me/login/request', { email: 'x' })).statusCode).toBe(422);
    expect((await post('/me/login/verify', { email: ana.email, code: '12ab56' })).statusCode).toBe(401);
  });
});

describe('sessão do hóspede', () => {
  it('sessão de hóspede não abre rotas internas, e sessão de funcionário não abre /me', async () => {
    const g = await signup(ana);
    const token = await signIn(ana.email);
    expect((await get(`/guests/${g.id}/balance`, bearer(token))).statusCode).toBe(401);
    expect((await post('/stays', {}, bearer(token))).statusCode).toBe(401);
    expect((await get('/me', ctx.headers)).statusCode).toBe(401);
    expect((await get('/me')).statusCode).toBe(401);
  });

  it('a rotina noturna apaga sessões vencidas e códigos antigos (igual ao banco)', async () => {
    const g = await signup(ana);
    await signIn(ana.email);
    clock = new Date(clock.getTime() + 2 * 86_400_000);
    const repo = new InMemoryMaintenanceRepository(ctx.stays, ctx.guests, () => clock, ctx.authRepo, ctx.portalRepo);
    await runNightly({ repo, now: () => clock });
    expect([...ctx.portalRepo.sessions.values()].filter((s) => s.guestId === g.id)).toHaveLength(0);
    expect(ctx.portalRepo.codes).toHaveLength(0);
  });

  it('sair encerra a sessão; a sessão vence em 24 horas', async () => {
    await signup(ana);
    const t1 = await signIn(ana.email);
    expect((await post('/me/logout', undefined, bearer(t1))).statusCode).toBe(204);
    expect((await get('/me', bearer(t1))).statusCode).toBe(401);

    const t2 = await signIn(ana.email);
    clock = new Date(clock.getTime() + 24 * 3_600_000);
    expect((await get('/me', bearer(t2))).statusCode).toBe(401);
  });
});

describe('o que o hóspede vê', () => {
  it('prêmios: o que já pode resgatar, quanto falta e o nível exigido', async () => {
    const g = await signup(ana);
    await earn(g.id, 2000);
    const mk = (body: object) => post('/rewards', body, ctx.headers);
    await mk({ name: 'Café da manhã', type: 'DINING', pointsCost: 1500 });
    await mk({ name: 'Diária grátis', type: 'FREE_NIGHT', pointsCost: 5000 });
    await mk({ name: 'Upgrade de suíte', type: 'UPGRADE', pointsCost: 1000, minTierRank: 2 });
    const token = await signIn(ana.email);
    const list = (await get('/me/rewards', bearer(token))).json();
    const by = (n: string) => list.find((r: { name: string }) => r.name === n);
    expect(by('Café da manhã')).toMatchObject({ canRedeem: true, missingPoints: 0 });
    expect(by('Diária grátis')).toMatchObject({ canRedeem: false, missingPoints: 3000, tierOk: true });
    expect(by('Upgrade de suíte')).toMatchObject({ canRedeem: false, tierOk: false, minTier: 'Ouro' });
    expect(list[0]).not.toHaveProperty('id');
  });

  it('nível vencido: página e recepção usam a mesma regra, o que os pontos garantem (ADR 0016)', async () => {
    const g = await signup(ana);
    await earn(g.id, 3500); // pontos-base de Prata
    const mk = (body: object) => post('/rewards', body, ctx.headers);
    await mk({ name: 'Jantar Prata', type: 'DINING', pointsCost: 1000, minTierRank: 1 });
    await mk({ name: 'Upgrade Ouro', type: 'UPGRADE', pointsCost: 1000, minTierRank: 2 });
    // Ouro com validade vencida e a rotina noturna ainda não rodou: vale Prata (pelos pontos).
    ctx.stays.tiers.set(g.id, { rank: 2, validUntil: new Date('2026-03-01T00:00:00Z') });
    const token = await signIn(ana.email);
    const list = (await get('/me/rewards', bearer(token))).json();
    const by = (n: string) => list.find((r: { name: string }) => r.name === n);
    expect(by('Jantar Prata')).toMatchObject({ canRedeem: true, tierOk: true });
    expect(by('Upgrade Ouro')).toMatchObject({ canRedeem: false, tierOk: false });
    // A recepção decide igual: aceita o de Prata e recusa o de Ouro.
    const ids = Object.fromEntries((await get('/rewards')).json().map((r: { name: string; id: string }) => [r.name, r.id]));
    const redeem = (name: string, requestId: string) =>
      post('/redemptions', { guestId: g.id, rewardId: ids[name], requestId }, ctx.headers);
    expect((await redeem('Upgrade Ouro', 'req-vencido-ouro-1')).json().error).toBe('tier_too_low');
    expect((await redeem('Jantar Prata', 'req-vencido-prata-1')).statusCode).toBe(201);
  });

  it('a data de vencimento mostrada é o último dia em que os pontos valem (ADR 0016)', async () => {
    const g = await signup(ana);
    await earn(g.id, 1000); // creditado em 01/03/2026: vale até o fim de 01/03/2028 no hotel
    const reward = (await post('/rewards', { name: 'Café', type: 'DINING', pointsCost: 500 }, ctx.headers)).json();
    const token = await signIn(ana.email);
    expect((await get('/me', bearer(token))).json().expiring).toEqual([{ date: '2028-03-01', points: 1000 }]);
    // Às 23h de 01/03/2028 em São Paulo (02h UTC do dia 2) o resgate ainda funciona...
    clock = new Date('2028-03-02T02:00:00Z');
    const ok = await post('/redemptions', { guestId: g.id, rewardId: reward.id, requestId: 'req-ultimo-dia-1' }, ctx.headers);
    expect(ok.statusCode).toBe(201);
    // ...e à 0h de 02/03 no hotel, não mais.
    clock = new Date('2028-03-02T03:00:00Z');
    const late = await post('/redemptions', { guestId: g.id, rewardId: reward.id, requestId: 'req-dia-seguinte-1' }, ctx.headers);
    expect(late.json().error).toBe('insufficient_points');
  });

  it('indicado vê os pontos de boas-vindas pendentes; nível mais alto não mostra próximo nível', async () => {
    const a = await signup(ana);
    await signup({ ...bia, referralCode: a.referralCode });
    const tb = await signIn(bia.email);
    expect((await get('/me', bearer(tb))).json()).toMatchObject({ points: { available: 0, pendingWelcome: 500 }, expiring: [] });

    await earn(a.id, 20_000);
    const ta = await signIn(ana.email);
    expect((await get('/me', bearer(ta))).json()).toMatchObject({ tier: { name: 'Diamante' }, progress: { nextTier: null } });
  });

  it('nível vencido (rotina noturna ainda não rodou) aparece pelo que os pontos garantem', async () => {
    const g = await signup(ana);
    ctx.stays.tiers.set(g.id, { rank: 2, validUntil: new Date('2026-02-01T00:00:00Z') });
    const token = await signIn(ana.email);
    expect((await get('/me', bearer(token))).json()).toMatchObject({ tier: { name: 'Bronze', validUntil: null } });
  });
});

describe('página e configuração', () => {
  it('a página "Minha conta" é servida com política de segurança restrita', async () => {
    const r = await get('/minha-conta');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.headers['content-security-policy']).toContain("script-src 'self'");
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.body).toContain('/minha-conta.js');
    expect((await get('/minha-conta.js')).statusCode).toBe(200);
    expect((await get('/minha-conta.css')).statusCode).toBe(200);
  });

  it('sem envio de código configurado, o login do hóspede responde 503', async () => {
    const guests = new InMemoryGuestRepository();
    const stays = new InMemoryStayRepository(guests);
    const rewards = new InMemoryRewardRepository(stays, guests);
    const app = buildApp({
      signup: { repo: guests, documentSecret: SECRET },
      loyalty: { stays },
      rewards: { repo: rewards },
      auth: { repo: new InMemoryAuthRepository(), audit: new InMemoryAuditRepository() },
      guestPortal: { repo: new InMemoryGuestPortalRepository(guests, stays), rewards, stays, codeSecret: SECRET },
    });
    const r = await app.inject({ method: 'POST', url: '/me/login/request', payload: { email: 'a@b.com' } });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: 'guest_login_unavailable' });
  });
});
