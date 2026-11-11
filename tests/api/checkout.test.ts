import { beforeEach, describe, expect, it } from 'vitest';
import { API_KEY, makeApp } from '../helpers';

const headers = { 'x-api-key': API_KEY };
const ana = {
  fullName: 'Ana Souza',
  email: 'ana@exemplo.com',
  phone: '12988887777',
  documentType: 'CPF',
  document: '529.982.247-25',
  birthDate: '1990-05-17',
  acceptedTerms: true,
};
const bia = { ...ana, fullName: 'Bia Lima', email: 'bia@x.com', document: '111.444.777-35' };

let ctx: ReturnType<typeof makeApp>;

const signup = async (body: object) => (await ctx.app.inject({ method: 'POST', url: '/guests', payload: body })).json();
const stay = (guestId: string, charges: object[], channel = 'DIRECT_WEBSITE', extra: object = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: '/stays',
    headers,
    payload: { guestId, channel, checkIn: '2026-07-10', checkOut: '2026-07-13', charges, ...extra },
  });
const checkout = (id: string) => ctx.app.inject({ method: 'POST', url: `/stays/${id}/checkout`, headers });

/** Registra e conclui uma estadia; devolve o resultado do check-out. */
async function complete(guestId: string, charges: object[], channel = 'DIRECT_WEBSITE') {
  const { id } = (await stay(guestId, charges, channel)).json();
  return (await checkout(id)).json();
}

beforeEach(() => {
  ctx = makeApp(undefined, () => new Date('2026-07-13T12:00:00Z'));
});

describe('segurança das rotas internas', () => {
  it('exige chave válida', async () => {
    const g = await signup(ana);
    const payload = { guestId: g.id, channel: 'PHONE', checkIn: '2026-07-10', checkOut: '2026-07-13', charges: [] };
    expect((await ctx.app.inject({ method: 'POST', url: '/stays', payload })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: '/stays', payload, headers: { 'x-api-key': 'errada' } })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: '/stays/x/checkout' })).statusCode).toBe(401);
  });
});

describe('POST /stays', () => {
  it('valida datas, valores e hóspede', async () => {
    const g = await signup(ana);
    expect((await stay(g.id, [], 'PHONE', { checkOut: '2026-07-09' })).statusCode).toBe(422);
    expect((await stay(g.id, [], 'PHONE', { checkIn: '2026-02-31' })).statusCode).toBe(422);
    expect((await stay(g.id, [{ category: 'ROOM', amount: 'x' }])).statusCode).toBe(422);
    expect((await stay(g.id, [], 'TELEPATIA')).statusCode).toBe(422);
    const r = await stay('7b0c4b7e-0000-4000-8000-000000000000', [{ category: 'ROOM', amount: 100 }]);
    expect(r.statusCode).toBe(404);
  });
});

describe('check-out e crédito de pontos', () => {
  it('diária + A&B + bônus de reserva direta no nível Bronze', async () => {
    const g = await signup(ana);
    const r = await complete(g.id, [
      { category: 'ROOM', amount: 2100 },
      { category: 'FNB', amount: 400 },
    ]);
    expect(r).toMatchObject({ alreadyProcessed: false, earned: 2920, tier: 'Bronze', upgraded: false });
    expect(ctx.stays.balance(g.id)).toBe(2920);
    expect(ctx.stays.transactions.every((t) => t.expiresAt.toISOString().startsWith('2028-07-13'))).toBe(true);
  });

  it('reserva por OTA não ganha o bônus de reserva direta', async () => {
    const g = await signup(ana);
    const r = await complete(g.id, [{ category: 'ROOM', amount: 1000 }], 'OTA');
    expect(r.earned).toBe(1000);
  });

  it('é idempotente: repetir o check-out não credita de novo', async () => {
    const g = await signup(ana);
    const { id } = (await stay(g.id, [{ category: 'ROOM', amount: 1000 }])).json();
    expect((await checkout(id)).json().earned).toBe(1200);
    const again = (await checkout(id)).json();
    expect(again).toMatchObject({ alreadyProcessed: true, earned: 0 });
    expect(ctx.stays.balance(g.id)).toBe(1200);
  });

  it('check-outs simultâneos da mesma estadia creditam uma vez só', async () => {
    const g = await signup(ana);
    const { id } = (await stay(g.id, [{ category: 'ROOM', amount: 1000 }])).json();
    await Promise.all([checkout(id), checkout(id), checkout(id)]);
    expect(ctx.stays.balance(g.id)).toBe(1200);
  });

  it('sobe de nível ao atingir o limiar e passa a usar o novo multiplicador', async () => {
    const g = await signup(ana);
    const first = await complete(g.id, [{ category: 'ROOM', amount: 3500 }], 'OTA');
    expect(first).toMatchObject({ earned: 3500, tier: 'Prata', upgraded: true });
    const second = await complete(g.id, [{ category: 'ROOM', amount: 1000 }], 'OTA');
    expect(second.earned).toBe(1250); // Prata: 1,25x
  });

  it('estorno no folio não gera pontos negativos', async () => {
    const g = await signup(ana);
    const r = await complete(g.id, [
      { category: 'ROOM', amount: 1000 },
      { category: 'SPA', amount: -200 },
    ], 'OTA');
    expect(r.earned).toBe(1000);
  });

  it('estadia inexistente: 404', async () => {
    expect((await checkout('nao-existe')).statusCode).toBe(404);
  });
});

describe('indicação (ADR 0006)', () => {
  it('boas-vindas e bônus do indicador saem só no 1º check-out com receita', async () => {
    const a = await signup(ana);
    const b = await signup({ ...bia, referralCode: a.referralCode });
    expect(b.pendingWelcomePoints).toBe(500);
    expect(ctx.stays.balance(b.id)).toBe(0);
    expect(ctx.stays.balance(a.id)).toBe(0);

    // estadia sem receita não libera nada
    await complete(b.id, []);
    expect(ctx.stays.balance(b.id)).toBe(0);
    expect(ctx.stays.balance(a.id)).toBe(0);

    // 1ª estadia com receita: 1000 (diária, OTA) + 500 boas-vindas; indicador +1000
    await complete(b.id, [{ category: 'ROOM', amount: 1000 }], 'OTA');
    expect(ctx.stays.balance(b.id)).toBe(1500);
    expect(ctx.stays.balance(a.id)).toBe(1000);

    // 2ª estadia: nada de bônus de novo
    await complete(b.id, [{ category: 'ROOM', amount: 1000 }], 'OTA');
    expect(ctx.stays.balance(b.id)).toBe(2500);
    expect(ctx.stays.balance(a.id)).toBe(1000);
  });
});
