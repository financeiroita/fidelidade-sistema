import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app';
import { ReferralCodeCollisionError } from '../../src/application/ports';
import { isValidCpf } from '../../src/domain/guests/cpf';
import { InMemoryGuestRepository } from '../../src/infra/memory/guestRepository';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const valid = {
  fullName: 'Ana Souza',
  email: 'Ana@Exemplo.com',
  phone: '(12) 98888-7777',
  documentType: 'CPF',
  document: '529.982.247-25',
  birthDate: '1990-05-17',
  acceptedTerms: true,
};

let repo: InMemoryGuestRepository;
let app: ReturnType<typeof buildApp>;
const post = (body: unknown) => app.inject({ method: 'POST', url: '/guests', payload: body as object });

beforeEach(() => {
  repo = new InMemoryGuestRepository();
  app = buildApp({ repo, documentSecret: SECRET });
});

describe('CPF', () => {
  it.each([
    ['529.982.247-25', true],
    ['52998224725', true],
    ['111.111.111-11', false],
    ['529.982.247-24', false],
    ['123', false],
  ])('%s → %s', (v, ok) => expect(isValidCpf(v)).toBe(ok));
});

describe('POST /guests', () => {
  it('cadastra, normaliza dados e não guarda o CPF em claro', async () => {
    const res = await post(valid);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tier).toBe('Bronze');
    expect(body.referralCode).toMatch(/^ANA-[A-Z0-9]{4}$/);
    const g = repo.guests[0];
    expect(g.email).toBe('ana@exemplo.com');
    expect(g.phone).toBe('12988887777');
    expect(g.documentHash).not.toContain('52998224725');
    expect(g.documentLast4).toBe('4725');
    expect(JSON.stringify(res.json())).not.toContain('52998224725');
  });

  it('recusa CPF inválido e falta de aceite', async () => {
    const r1 = await post({ ...valid, document: '111.111.111-11' });
    expect(r1.statusCode).toBe(422);
    expect(r1.json().issues[0].field).toBe('document');
    const r2 = await post({ ...valid, acceptedTerms: false });
    expect(r2.statusCode).toBe(422);
  });

  it('aceita passaporte para estrangeiro', async () => {
    const res = await post({ ...valid, documentType: 'PASSPORT', document: 'ab 123456' });
    expect(res.statusCode).toBe(201);
  });

  it('marketing só com consentimento explícito', async () => {
    await post(valid);
    expect(repo.guests[0].marketingConsent).toBe(false);
  });

  it('bloqueia duplicidade por CPF (mesmo com máscara diferente) e por e-mail', async () => {
    expect((await post(valid)).statusCode).toBe(201);
    expect((await post({ ...valid, email: 'outro@x.com', document: '52998224725' })).statusCode).toBe(409);
    expect((await post({ ...valid, document: '111.444.777-35' })).statusCode).toBe(409);
  });

  it('indicação válida deixa boas-vindas pendentes (sem crédito) e registra o indicador', async () => {
    const first = (await post(valid)).json();
    const res = await post({
      ...valid,
      fullName: 'Bia Lima',
      email: 'bia@x.com',
      document: '111.444.777-35',
      referralCode: first.referralCode.toLowerCase(),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().pendingWelcomePoints).toBe(500);
    expect(repo.guests[1].welcomeBonusPending).toBe(500);
    expect(repo.guests[1].referredById).toBe(repo.guests[0].id);
  });

  it('código de indicação inexistente não impede o cadastro', async () => {
    const res = await post({ ...valid, referralCode: 'NAO-EXST' });
    expect(res.statusCode).toBe(201);
    expect(res.json().pendingWelcomePoints).toBe(0);
  });

  it('recusa data impossível, futura e telefone inválido', async () => {
    for (const patch of [
      { birthDate: '1990-02-31' },
      { birthDate: '2999-01-01' },
      { phone: '0000000000' },
      { phone: '123' },
    ]) {
      expect((await post({ ...valid, ...patch })).statusCode).toBe(422);
    }
  });

  it('passaporte com formatos diferentes é o mesmo documento', async () => {
    const p = { ...valid, documentType: 'PASSPORT' };
    expect((await post({ ...p, document: 'AB-123456' })).statusCode).toBe(201);
    expect((await post({ ...p, email: 'z@x.com', document: 'ab 123456' })).statusCode).toBe(409);
    expect((await post({ ...p, email: 'y@x.com', document: '<script>' })).statusCode).toBe(422);
  });

  it('dois cadastros simultâneos com o mesmo CPF: um 201 e um 409', async () => {
    const [a, b] = await Promise.all([post(valid), post({ ...valid, email: 'outro@x.com' })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
  });

  it('colisão do código de indicação tenta de novo e não vira 409', async () => {
    let calls = 0;
    const flaky = new InMemoryGuestRepository();
    const real = flaky.create.bind(flaky);
    flaky.create = async (g, c) => {
      if (calls++ === 0) throw new ReferralCodeCollisionError();
      return real(g, c);
    };
    const a = buildApp({ repo: flaky, documentSecret: SECRET });
    const res = await a.inject({ method: 'POST', url: '/guests', payload: valid });
    expect(res.statusCode).toBe(201);
    expect(calls).toBe(2);
  });

  it('GET /health', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
  });
});
