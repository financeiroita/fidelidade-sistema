import { beforeEach, describe, expect, it } from 'vitest';
import { runNightly } from '../../src/application/maintenance';
import { planNotices, planTierReview, type LotRow } from '../../src/domain/points/maintenance';
import { loyaltyConfig as cfg } from '../../src/config/loyalty';
import { InMemoryMaintenanceRepository } from '../../src/infra/memory/maintenanceRepository';
import { makeApp } from '../helpers';
import { lastValidDay } from '../../src/domain/time';

let headers: Record<string, string>; // gerente de teste (ver tests/helpers.ts)
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
let maint: InMemoryMaintenanceRepository;
let seq = 0;

/** Lança e conclui uma estadia na data atual do relógio de teste. */
async function stayDone(guestId: string, amount: number) {
  const day = clock.toISOString().slice(0, 10);
  const prev = new Date(clock.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const s = await ctx.app.inject({
    method: 'POST',
    url: '/stays',
    headers,
    payload: {
      guestId,
      channel: 'OTA',
      checkIn: prev,
      checkOut: day,
      externalRef: `M-${++seq}`,
      charges: [{ category: 'ROOM', amount }],
    },
  });
  return (await ctx.app.inject({ method: 'POST', url: `/stays/${s.json().id}/checkout`, headers })).json();
}
const run = () => runNightly({ repo: maint, now: () => clock });

beforeEach(() => {
  clock = new Date('2026-03-01T12:00:00Z');
  ctx = makeApp(undefined, () => clock);
  headers = ctx.headers;
  maint = new InMemoryMaintenanceRepository(ctx.stays, ctx.guests, () => clock);
});

const guest = async () => (await ctx.app.inject({ method: 'POST', url: '/guests', payload: ana })).json();

describe('vencimento de pontos', () => {
  it('expira o lote vencido uma única vez e zera o saldo', async () => {
    const g = await guest();
    await stayDone(g.id, 1000); // 1.000 pontos, vencem em 2028-03-01
    clock = new Date('2028-03-02T03:00:00Z');
    const r1 = await run();
    expect(r1).toMatchObject({ expiredLots: 1, expiredPoints: 1000, errors: 0 });
    expect(ctx.stays.balance(g.id)).toBe(0);
    const r2 = await run();
    expect(r2.expiredLots).toBe(0);
    expect(ctx.stays.balance(g.id)).toBe(0);
  });

  it('não mexe em pontos que ainda não venceram', async () => {
    const g = await guest();
    await stayDone(g.id, 1000);
    clock = new Date('2027-03-01T00:00:00Z');
    expect((await run()).expiredLots).toBe(0);
    expect(ctx.stays.balance(g.id)).toBe(1000);
  });
});

describe('avisos de vencimento', () => {
  it('gera um aviso na janela certa e não repete na rodada seguinte', async () => {
    const g = await guest();
    await stayDone(g.id, 1000); // vence 2028-03-01
    clock = new Date('2027-12-20T00:00:00Z'); // faltam ~72 dias: janela de 90
    expect((await run()).noticesCreated).toBe(1);
    expect(maint.notices[0]).toMatchObject({ windowDays: 90, points: 1000 });
    expect((await run()).noticesCreated).toBe(0);
    clock = new Date('2028-02-10T00:00:00Z'); // faltam ~20 dias: janela de 30
    expect((await run()).noticesCreated).toBe(1);
    expect(maint.notices.map((n) => n.windowDays)).toEqual([90, 30]);
  });

  it('planNotices usa só a menor janela aplicável e soma os lotes dentro dela', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const d = (days: number) => new Date(now.getTime() + days * 86_400_000);
    const lots: LotRow[] = [
      { id: 'a', guestId: 'g', remaining: 100, expiresAt: d(10), guestActive: true },
      { id: 'b', guestId: 'g', remaining: 200, expiresAt: d(50), guestActive: true },
      { id: 'c', guestId: 'g', remaining: 400, expiresAt: d(200), guestActive: true },
      { id: 'x', guestId: 'h', remaining: 50, expiresAt: d(400), guestActive: true },
    ];
    const plans = planNotices(lots, now, [90, 30]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ guestId: 'g', windowDays: 30, points: 100 });
  });

  it('não avisa hóspede anonimizado, e respeita o limite exato da janela', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const at = (ms: number) => new Date(now.getTime() + ms);
    const day = 86_400_000;
    const lots: LotRow[] = [
      { id: 'a', guestId: 'anon', remaining: 100, expiresAt: at(day), guestActive: false },
      { id: 'b', guestId: 'no-limite', remaining: 10, expiresAt: at(30 * day), guestActive: true },
      { id: 'c', guestId: 'fora', remaining: 10, expiresAt: at(90 * day + 1), guestActive: true },
    ];
    const plans = planNotices(lots, now, [90, 30]);
    expect(plans.map((p) => [p.guestId, p.windowDays])).toEqual([['no-limite', 30]]);
  });
});

describe('sessões de login vencidas', () => {
  it('a rotina apaga as vencidas e mantém as válidas', async () => {
    const withAuth = new InMemoryMaintenanceRepository(ctx.stays, ctx.guests, () => clock, ctx.authRepo);
    ctx.authRepo.sessions.set('velha', { operatorId: 'x', expiresAt: new Date('2026-02-28T00:00:00Z') });
    ctx.authRepo.sessions.set('valida', { operatorId: 'x', expiresAt: new Date('2026-04-01T00:00:00Z') });
    const r = await runNightly({ repo: withAuth, now: () => clock });
    expect(r.sessionsPurged).toBe(1);
    expect(ctx.authRepo.sessions.has('velha')).toBe(false);
    expect(ctx.authRepo.sessions.has('valida')).toBe(true);
  });
});

describe('limites e falhas', () => {
  it('lote que vence exatamente agora expira; 1 ms antes do vencimento, não', async () => {
    const g = await guest();
    await stayDone(g.id, 1000); // vale até o fim de 01/03/2028 no hotel: vence em 2028-03-02T03:00:00.000Z
    clock = new Date('2028-03-02T02:59:59.999Z');
    expect((await run()).expiredLots).toBe(0);
    clock = new Date('2028-03-02T03:00:00.000Z');
    expect((await run()).expiredLots).toBe(1);
  });

  it('lote com saldo diferente do lido não expira naquela noite e expira certo na seguinte', async () => {
    const g = await guest();
    await stayDone(g.id, 1000);
    clock = new Date('2028-03-02T03:00:00Z');
    const lot = ctx.stays.transactions.find((t) => t.type === 'EARN_STAY')!;
    const real = maint.loadActiveLots.bind(maint);
    maint.loadActiveLots = async (until) => {
      const rows = await real(until);
      lot.remaining -= 200; // um resgate parcial acontece depois da leitura
      return rows;
    };
    expect((await run()).expiredLots).toBe(0);
    maint.loadActiveLots = real;
    const second = await run();
    expect(second).toMatchObject({ expiredLots: 1, expiredPoints: 800 }); // só o saldo que sobrou
    expect(lot.remaining).toBe(0);
  });

  it('falha em um lote conta o erro, registra a causa sem dados pessoais e segue com os demais', async () => {
    const a = await guest();
    await stayDone(a.id, 1000);
    const b = (
      await ctx.app.inject({
        method: 'POST',
        url: '/guests',
        payload: { ...ana, email: 'b@x.com', document: '111.444.777-35' },
      })
    ).json();
    await stayDone(b.id, 2000);
    clock = new Date('2028-03-02T03:00:00Z');
    const events: Array<{ step: string; id?: string; code: string }> = [];
    const real = maint.expireLot.bind(maint);
    let first = true;
    maint.expireLot = async (item, now) => {
      if (first) {
        first = false;
        throw Object.assign(new Error('detalhe com e-mail ana@exemplo.com'), { code: 'P1001' });
      }
      return real(item, now);
    };
    const r = await runNightly({ repo: maint, now: () => clock, logger: (e) => events.push(e) });
    expect(r).toMatchObject({ errors: 1, expiredLots: 1 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ step: 'expirar-lote', code: 'P1001' });
    expect(JSON.stringify(events)).not.toContain('ana@exemplo.com');
  });

  it('falha ao carregar os lotes não impede a revisão de nível', async () => {
    const g = await guest();
    await stayDone(g.id, 3500);
    clock = new Date('2027-03-02T03:00:00Z');
    maint.loadActiveLots = async () => {
      throw new Error('banco fora');
    };
    const r = await run();
    expect(r.errors).toBe(1);
    expect(r).toMatchObject({ tierReviews: 1, tierDowngrades: 1 });
  });
});

describe('nível vencido no check-out (rotina ainda não rodou)', () => {
  it('não dá o multiplicador do nível vencido: vale o que o hóspede realmente atinge', async () => {
    const g = await guest();
    expect((await stayDone(g.id, 3500)).tier).toBe('Prata'); // Prata até 2027-03-01
    clock = new Date('2027-06-01T12:00:00Z'); // validade vencida, a rotina não rodou
    const r = await stayDone(g.id, 1000);
    expect(r.earned).toBe(1000); // sem 1,25x: nos últimos 12 meses ele tem 0 pontos-base
  });
});

describe('revisão de nível', () => {
  it('rebaixa quando a validade acaba sem pontos-base suficientes', async () => {
    const g = await guest();
    const r = await stayDone(g.id, 3500);
    expect(r.tier).toBe('Prata');
    clock = new Date('2027-03-02T03:00:00Z'); // 12 meses depois: validade vencida
    const res = await run();
    expect(res).toMatchObject({ tierReviews: 1, tierDowngrades: 1 });
    expect(ctx.stays.tiers.get(g.id)).toMatchObject({ rank: 0 });
  });

  it('quem manteve o nível num novo check-out tem a validade renovada e não é rebaixado na data antiga', async () => {
    const g = await guest();
    await stayDone(g.id, 3500); // Prata até 2027-03-01
    clock = new Date('2026-12-01T12:00:00Z');
    await stayDone(g.id, 3000); // base na janela = 6.500: mantém e renova até 2027-12-01
    expect(lastValidDay(ctx.stays.tiers.get(g.id)!.validUntil!, 'America/Sao_Paulo')).toBe('2027-12-01');
    clock = new Date('2027-03-02T03:00:00Z');
    expect((await run()).tierReviews).toBe(0);
    expect(ctx.stays.tiers.get(g.id)!.rank).toBe(1);
    clock = new Date('2027-12-02T03:00:00Z'); // sem atividade nos últimos 12 meses
    expect(await run()).toMatchObject({ tierReviews: 1, tierDowngrades: 1 });
  });

  it('não revisa quem está dentro da validade', async () => {
    const g = await guest();
    await stayDone(g.id, 3500);
    clock = new Date('2026-09-01T00:00:00Z');
    expect((await run()).tierReviews).toBe(0);
    expect(ctx.stays.tiers.get(g.id)!.rank).toBe(1);
  });

  it('planTierReview: Bronze fica sem validade; níveis pagos ganham 12 meses', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    expect(planTierReview(100, now, cfg)).toEqual({ newRank: 0, validUntil: null });
    const p = planTierReview(8000, now, cfg);
    expect(p.newRank).toBe(2);
    expect(lastValidDay(p.validUntil!, 'America/Sao_Paulo')).toBe('2027-01-01');
  });
});
