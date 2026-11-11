import { beforeEach, describe, expect, it } from 'vitest';
import { runNightly } from '../../src/application/maintenance';
import { InMemoryMaintenanceRepository } from '../../src/infra/memory/maintenanceRepository';
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

let clock: Date;
let ctx: ReturnType<typeof makeApp>;
let seq = 0;

const post = async (url: string, payload?: object, h: Record<string, string> = headers) =>
  await ctx.app.inject({ method: 'POST', url, payload: payload as object, headers: h });
const get = async (url: string) => await ctx.app.inject({ method: 'GET', url, headers });

const newGuest = async (over: object = {}) => (await post('/guests', { ...ana, ...over }, {})).json();

/** Dá pontos ao hóspede com uma estadia concluída (OTA: 1 ponto por R$ 1 no Bronze). */
async function earn(guestId: string, amount: number) {
  const day = clock.toISOString().slice(0, 10);
  const prev = new Date(clock.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const s = await post('/stays', {
    guestId,
    channel: 'OTA',
    checkIn: prev,
    checkOut: day,
    externalRef: `R-${++seq}`,
    charges: [{ category: 'ROOM', amount }],
  });
  await post(`/stays/${s.json().id}/checkout`);
}

const newReward = async (over: object = {}) =>
  (await post('/rewards', { name: 'Jantar para dois', type: 'DINING', pointsCost: 1500, ...over })).json();

const redeem = (guestId: string, rewardId: string, requestId = `req-${++seq}-abcdefgh`) =>
  post('/redemptions', { guestId, rewardId, requestId });

const balance = async (guestId: string) => (await get(`/guests/${guestId}/balance`)).json();

beforeEach(() => {
  clock = new Date('2026-03-01T12:00:00Z');
  ctx = makeApp(undefined, () => clock);
});

describe('catálogo', () => {
  it('cadastrar exige a chave; a lista é pública, só com ativos e por preço', async () => {
    expect((await post('/rewards', { name: 'X', type: 'SPA', pointsCost: 10 }, {})).statusCode).toBe(401);
    await newReward({ name: 'Massagem', type: 'SPA', pointsCost: 3000 });
    await newReward({ name: 'Café da manhã', type: 'DINING', pointsCost: 800 });
    const list = (await ctx.app.inject({ method: 'GET', url: '/rewards' })).json();
    expect(list.map((r: { name: string }) => r.name)).toEqual(['Café da manhã', 'Massagem']);
    expect(Object.keys(list[0]).sort()).toEqual(['description', 'id', 'minTierRank', 'name', 'pointsCost', 'type']);
  });

  it('valida o cadastro do prêmio', async () => {
    expect((await post('/rewards', { name: 'X', type: 'SPA', pointsCost: 0 })).statusCode).toBe(422);
    expect((await post('/rewards', { name: 'Prêmio', type: 'CARRO', pointsCost: 10 })).statusCode).toBe(422);
  });
});

describe('resgate', () => {
  it('abate o saldo, cria o resgate pendente e mostra no extrato', async () => {
    const g = await newGuest();
    await earn(g.id, 2000);
    const reward = await newReward();
    const res = await redeem(g.id, reward.id);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'PENDING', points: 1500, replay: false });
    expect(res.json().code).toMatch(/^RES-[A-Z0-9]{10}$/);
    expect(await balance(g.id)).toMatchObject({ available: 500, ledger: 500 });
    const statement = (await get(`/guests/${g.id}/statement`)).json();
    expect(statement[0]).toMatchObject({ type: 'REDEEM', points: -1500 });
  });

  it('saldo insuficiente: 409 e nada muda', async () => {
    const g = await newGuest();
    await earn(g.id, 1000);
    const reward = await newReward();
    const res = await redeem(g.id, reward.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'insufficient_points', available: 1000 });
    expect(await balance(g.id)).toMatchObject({ available: 1000, ledger: 1000 });
  });

  it('usa primeiro os pontos que vencem antes', async () => {
    const g = await newGuest();
    await earn(g.id, 1000); // vence 2028-03-01
    clock = new Date('2026-09-01T12:00:00Z');
    await earn(g.id, 1000); // vence 2028-09-01
    const lots = ctx.stays.transactions.filter((t) => t.type === 'EARN_STAY');
    const reward = await newReward({ pointsCost: 1200 });
    expect((await redeem(g.id, reward.id)).statusCode).toBe(201);
    expect(lots.map((l) => l.remaining)).toEqual([0, 800]);
  });

  it('pontos vencidos (a rotina ainda não rodou) não contam como saldo', async () => {
    const g = await newGuest();
    await earn(g.id, 1000);
    clock = new Date('2028-03-02T00:00:00Z');
    const reward = await newReward({ pointsCost: 500 });
    expect((await redeem(g.id, reward.id)).json()).toEqual({ error: 'insufficient_points', available: 0 });
    expect(await balance(g.id)).toMatchObject({ available: 0, ledger: 1000 });
  });

  it('é idempotente por requestId; o mesmo requestId em outro prêmio é recusado', async () => {
    const g = await newGuest();
    await earn(g.id, 3000);
    const r1 = await newReward();
    const r2 = await newReward({ name: 'Outro', pointsCost: 100 });
    const first = await redeem(g.id, r1.id, 'pedido-unico-0001');
    const again = await redeem(g.id, r1.id, 'pedido-unico-0001');
    expect([first.statusCode, again.statusCode]).toEqual([201, 200]);
    expect(again.json()).toMatchObject({ id: first.json().id, replay: true });
    expect((await balance(g.id)).available).toBe(1500);
    expect((await redeem(g.id, r2.id, 'pedido-unico-0001')).json()).toEqual({ error: 'request_id_reused' });
  });

  it('dois pedidos simultâneos que não cabem no saldo: só um passa', async () => {
    const g = await newGuest();
    await earn(g.id, 1000);
    const reward = await newReward({ pointsCost: 800 });
    const [a, b] = await Promise.all([redeem(g.id, reward.id), redeem(g.id, reward.id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect((await balance(g.id)).available).toBe(200);
  });

  it('prêmio restrito por nível: Bronze recusado, Prata liberado', async () => {
    const g = await newGuest();
    await earn(g.id, 1000);
    const reward = await newReward({ pointsCost: 500, minTierRank: 1 });
    expect((await redeem(g.id, reward.id)).statusCode).toBe(403);
    await earn(g.id, 3000); // 4.000 pontos-base: Prata
    expect((await redeem(g.id, reward.id)).statusCode).toBe(201);
  });

  it('nível vencido não abre prêmio restrito', async () => {
    const g = await newGuest();
    await earn(g.id, 3500); // Prata até 2027-03-01
    const reward = await newReward({ pointsCost: 500, minTierRank: 1 });
    clock = new Date('2027-06-01T12:00:00Z'); // validade vencida, rotina não rodou
    expect((await redeem(g.id, reward.id)).statusCode).toBe(403);
  });

  it('hóspede ou prêmio inexistente ou inativo: 404', async () => {
    const g = await newGuest();
    await earn(g.id, 1000);
    const reward = await newReward({ pointsCost: 100 });
    const nobody = '7b0c4b7e-0000-4000-8000-000000000000';
    expect((await redeem(nobody, reward.id)).statusCode).toBe(404);
    expect((await redeem(g.id, nobody)).statusCode).toBe(404);
    ctx.rewards.rewards.get(reward.id)!.active = false;
    expect((await redeem(g.id, reward.id)).json()).toEqual({ error: 'reward_not_available' });
  });

  it('valida o pedido', async () => {
    expect((await post('/redemptions', { guestId: 'x', rewardId: 'y', requestId: 'curto' })).statusCode).toBe(422);
    expect((await post('/redemptions', {}, {})).statusCode).toBe(401);
  });
});

describe('ciclo do resgate', () => {
  async function pending() {
    const g = await newGuest();
    await earn(g.id, 2000);
    const reward = await newReward();
    const r = (await redeem(g.id, reward.id)).json();
    return { g, r };
  }

  it('confirmar e usar, repetindo sem efeito; usar sem confirmar é recusado', async () => {
    const { r } = await pending();
    expect((await post(`/redemptions/${r.id}/use`)).statusCode).toBe(409);
    expect((await post(`/redemptions/${r.id}/confirm`)).json().status).toBe('CONFIRMED');
    expect((await post(`/redemptions/${r.id}/confirm`)).json().status).toBe('CONFIRMED');
    const used = await post(`/redemptions/${r.id}/use`, { stayId: '7b0c4b7e-0000-4000-8000-0000000000aa' });
    expect(used.json()).toMatchObject({ status: 'USED', stayId: '7b0c4b7e-0000-4000-8000-0000000000aa' });
    expect((await post(`/redemptions/${r.id}/use`)).json().status).toBe('USED');
  });

  it('cancelar devolve os pontos aos lotes de origem; repetir não devolve de novo', async () => {
    const { g, r } = await pending();
    expect((await post(`/redemptions/${r.id}/cancel`)).json().status).toBe('CANCELLED');
    expect(await balance(g.id)).toMatchObject({ available: 2000, ledger: 2000 });
    expect((await post(`/redemptions/${r.id}/cancel`)).json().status).toBe('CANCELLED');
    expect(await balance(g.id)).toMatchObject({ available: 2000, ledger: 2000 });
  });

  it('resgate já usado não pode ser cancelado nem confirmado de novo', async () => {
    const { r } = await pending();
    await post(`/redemptions/${r.id}/confirm`);
    await post(`/redemptions/${r.id}/use`);
    expect((await post(`/redemptions/${r.id}/cancel`)).statusCode).toBe(409);
  });

  it('cancelar depois de o lote vencer não devolve saldo utilizável; a rotina o expira sem perda dupla', async () => {
    const g = await newGuest();
    await earn(g.id, 1000); // vence 2028-03-01
    const reward = await newReward({ pointsCost: 1000 });
    const r = (await redeem(g.id, reward.id)).json();
    clock = new Date('2028-03-05T00:00:00Z');
    await post(`/redemptions/${r.id}/cancel`);
    expect(await balance(g.id)).toMatchObject({ available: 0 }); // lote vencido não é utilizável
    const maint = new InMemoryMaintenanceRepository(ctx.stays, ctx.guests, () => clock);
    expect(await runNightly({ repo: maint, now: () => clock })).toMatchObject({ expiredLots: 1, expiredPoints: 1000 });
    expect((await balance(g.id)).ledger).toBe(0); // +1000 ganho, -1000 resgate, +1000 devolução, -1000 vencido
  });

  it('id inválido ou inexistente: 404', async () => {
    expect((await post('/redemptions/nao-e-uuid/cancel')).statusCode).toBe(404);
    expect((await post('/redemptions/7b0c4b7e-0000-4000-8000-000000000000/confirm')).statusCode).toBe(404);
  });
});

describe('saldo e extrato', () => {
  it('mostra saldo disponível, razão e boas-vindas pendentes; exige chave', async () => {
    const a = await newGuest();
    const b = await newGuest({ fullName: 'Bia Lima', email: 'bia@x.com', document: '111.444.777-35', referralCode: a.referralCode });
    expect(await balance(b.id)).toEqual({ available: 0, ledger: 0, pendingWelcome: 500 });
    expect((await ctx.app.inject({ method: 'GET', url: `/guests/${b.id}/balance` })).statusCode).toBe(401);
    expect((await get('/guests/7b0c4b7e-0000-4000-8000-000000000000/balance')).statusCode).toBe(404);
    expect((await get('/guests/lixo/balance')).statusCode).toBe(404);
  });

  it('o extrato respeita o limite', async () => {
    const g = await newGuest();
    await earn(g.id, 1000);
    await earn(g.id, 500);
    expect((await get(`/guests/${g.id}/statement?limit=1`)).json()).toHaveLength(1);
  });
});
