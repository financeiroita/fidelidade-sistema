import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app';
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

  it('indicação válida dá boas-vindas ao indicado e registra o indicador', async () => {
    const first = (await post(valid)).json();
    const res = await post({
      ...valid,
      fullName: 'Bia Lima',
      email: 'bia@x.com',
      document: '111.444.777-35',
      referralCode: first.referralCode.toLowerCase(),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().welcomePoints).toBe(500);
    expect(repo.credits).toHaveLength(1);
    expect(repo.credits[0].points).toBe(500);
    expect(repo.guests[1].referredById).toBe(repo.guests[0].id);
  });

  it('código de indicação inexistente não impede o cadastro', async () => {
    const res = await post({ ...valid, referralCode: 'NAO-EXST' });
    expect(res.statusCode).toBe(201);
    expect(res.json().welcomePoints).toBe(0);
  });

  it('GET /health', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toEqual({ status: 'ok' });
  });
});
