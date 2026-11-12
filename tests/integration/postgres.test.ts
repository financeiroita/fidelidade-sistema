// Testes contra um PostgreSQL de verdade: travas de linha, restrições do banco, erros P2002,
// SQL cru do Prisma e concorrência. Os testes em memória não conseguem provar nada disso.
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../src/api/app';
import { createOperator } from '../../src/application/auth';
import { processCheckout } from '../../src/application/checkout';
import { StayNotEligibleError } from '../../src/application/ports';
import { runNightly } from '../../src/application/maintenance';
import { loyaltyConfig } from '../../src/config/loyalty';
import { PrismaAuditRepository, PrismaAuthRepository } from '../../src/infra/prisma/authRepository';
import { PrismaGuestPortalRepository } from '../../src/infra/prisma/guestPortalRepository';
import { PrismaGuestRepository } from '../../src/infra/prisma/guestRepository';
import { PrismaMaintenanceRepository } from '../../src/infra/prisma/maintenanceRepository';
import { PrismaRewardRepository } from '../../src/infra/prisma/rewardRepository';
import { PrismaStayRepository } from '../../src/infra/prisma/stayRepository';

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const PASSWORD = 'Senha-Forte-Teste-93!';
const HIGH = 100_000;

let prisma: PrismaClient;
let clock: Date;
let app: ReturnType<typeof buildApp>;
let authRepo: PrismaAuthRepository;
let headers: Record<string, string>;
let seq = 0;
let sent: Array<{ email: string; code: string }> = [];
/** Pedidos de código rodam em segundo plano; `flush()` espera todos terminarem. */
const pending: Array<Promise<void>> = [];
const flush = async () => {
  while (pending.length) await pending.shift();
};

const ana = {
  fullName: 'Ana Souza',
  email: 'ana@exemplo.com',
  phone: '12988887777',
  documentType: 'CPF',
  document: '529.982.247-25',
  birthDate: '1990-05-17',
  acceptedTerms: true,
};

const post = (url: string, payload?: object, h: Record<string, string> = headers) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers: h });

async function loginAs(username: string) {
  const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { username, password: PASSWORD } });
  expect(r.statusCode).toBe(200);
  return { authorization: `Bearer ${r.json().token}` } as Record<string, string>;
}

const newGuest = async (over: object = {}) => {
  const r = await post('/guests', { ...ana, ...over }, {});
  expect(r.statusCode).toBe(201);
  return r.json() as { id: string };
};

async function stayDone(guestId: string, amount: number) {
  const day = clock.toISOString().slice(0, 10);
  const prev = new Date(clock.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const s = await post('/stays', {
    guestId,
    channel: 'OTA',
    checkIn: prev,
    checkOut: day,
    externalRef: `PG-${++seq}`,
    charges: [{ category: 'ROOM', amount }],
  });
  expect(s.statusCode).toBe(201);
  const c = await post(`/stays/${s.json().id}/checkout`);
  expect(c.statusCode).toBe(200);
  return c.json();
}

const ledger = async (guestId: string) =>
  (await prisma.pointsTransaction.aggregate({ where: { guestId }, _sum: { points: true } }))._sum.points ?? 0;
const lotsLeft = async (guestId: string) =>
  (await prisma.pointsTransaction.aggregate({ where: { guestId, remaining: { gt: 0 } }, _sum: { remaining: true } }))._sum
    .remaining ?? 0;

const newReward = async (pointsCost: number) => {
  const r = await post('/rewards', { name: 'Jantar', type: 'DINING', pointsCost });
  expect(r.statusCode).toBe(201);
  return r.json() as { id: string };
};

beforeAll(async () => {
  prisma = new PrismaClient({ datasources: { db: { url: inject('databaseUrl') } } });
  for (const t of loyaltyConfig.tiers) {
    await prisma.tier.upsert({
      where: { rank: t.rank },
      update: {},
      create: { name: t.name, rank: t.rank, minQualifyingPts: t.minQualifyingPts, multiplier: t.multiplier },
    });
  }
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLog","Session","GuestSession","GuestLoginCode","Operator","ExpiryNotice","RedemptionLot","Redemption","Reward","PointsTransaction","StayCharge","Stay","Guest" RESTART IDENTITY CASCADE',
  );
  clock = new Date('2026-03-01T12:00:00Z');
  const now = () => clock;
  authRepo = new PrismaAuthRepository(prisma);
  const auditRepo = new PrismaAuditRepository(prisma);
  const stays = new PrismaStayRepository(prisma);
  const rewards = new PrismaRewardRepository(prisma);
  sent = [];
  app = buildApp(
    {
      signup: { repo: new PrismaGuestRepository(prisma), documentSecret: SECRET, now },
      loyalty: { stays, now },
      rewards: { repo: rewards, now },
      auth: { repo: authRepo, audit: auditRepo, now },
      guestPortal: {
        repo: new PrismaGuestPortalRepository(prisma),
        rewards,
        stays,
        now,
        codeSecret: SECRET,
        sender: { send: async (to, code) => void sent.push({ email: to.email, code }) },
        track: (t) => void pending.push(t),
      },
    },
    { limits: { login: HIGH, password: HIGH, guests: HIGH, guestLogin: HIGH } },
  );
  await createOperator({ repo: authRepo, audit: auditRepo, now }, { username: 'gerente', name: 'Gerente', role: 'MANAGER', password: PASSWORD });
  headers = await loginAs('gerente');
});

describe('banco e restrições', () => {
  it('as migrações criaram as restrições de integridade', async () => {
    const g = await newGuest();
    await stayDone(g.id, 1000);
    const lot = await prisma.pointsTransaction.findFirstOrThrow({ where: { guestId: g.id, remaining: { gt: 0 } } });
    const reward = await newReward(500);
    const red = (await post('/redemptions', { guestId: g.id, rewardId: reward.id, requestId: 'req-restricoes-1' })).json();
    const violates = async (name: string, run: () => Promise<unknown>) => {
      const err = await run().then(
        () => null,
        (e: Error) => e,
      );
      expect(err, `a restrição ${name} deveria recusar`).not.toBeNull();
      expect(String(err!.message)).toContain(name); // recusou pela restrição certa, não por outro erro de SQL
    };
    await violates('PointsTransaction_remaining_nonneg', () =>
      prisma.$executeRaw`UPDATE "PointsTransaction" SET "remaining" = -1 WHERE id = ${lot.id}`,
    );
    await violates('PointsTransaction_remaining_le_points', () =>
      prisma.$executeRaw`UPDATE "PointsTransaction" SET "remaining" = "points" + 1 WHERE id = ${lot.id}`,
    );
    await violates('Redemption_points_positive', () =>
      prisma.$executeRaw`UPDATE "Redemption" SET "points" = 0 WHERE id = ${red.id}`,
    );
    await violates('RedemptionLot_points_positive', () =>
      prisma.$executeRaw`UPDATE "RedemptionLot" SET "points" = 0 WHERE "redemptionId" = ${red.id}`,
    );
    await violates('Guest_welcome_nonneg', () =>
      prisma.$executeRaw`UPDATE "Guest" SET "welcomeBonusPending" = -1 WHERE id = ${g.id}`,
    );
    // Restrições da migração 20261112000004 (ADR 0016).
    await violates('PointsTransaction_qualifying_nonneg', () =>
      prisma.$executeRaw`UPDATE "PointsTransaction" SET "qualifyingPts" = -1 WHERE id = ${lot.id}`,
    );
    await violates('PointsTransaction_lot_has_expiry', () =>
      prisma.$executeRaw`UPDATE "PointsTransaction" SET "expiresAt" = NULL WHERE id = ${lot.id}`,
    );
    await violates('Reward_cost_positive', () =>
      prisma.$executeRaw`UPDATE "Reward" SET "pointsCost" = 0 WHERE id = ${reward.id}`,
    );
    await violates('Reward_min_tier_nonneg', () =>
      prisma.$executeRaw`UPDATE "Reward" SET "minTierRank" = -1 WHERE id = ${reward.id}`,
    );
    await violates('Stay_dates_in_order', () =>
      prisma.$executeRaw`UPDATE "Stay" SET "checkOut" = "checkIn" - 1 WHERE "guestId" = ${g.id}`,
    );
    await violates('Stay_nights_nonneg', () => prisma.$executeRaw`UPDATE "Stay" SET "nights" = -1 WHERE "guestId" = ${g.id}`);
    await violates('Operator_failed_attempts_nonneg', () => prisma.$executeRaw`UPDATE "Operator" SET "failedAttempts" = -1`);
    await violates('ExpiryNotice_points_positive', () =>
      prisma.$executeRaw`INSERT INTO "ExpiryNotice" (id, "guestId", "windowDays", points, "expiresOn") VALUES ('n-zero', ${g.id}, 30, 0, '2028-03-01')`,
    );
    await violates('GuestSession_expires_after_creation', () =>
      prisma.$executeRaw`INSERT INTO "GuestSession" (id, "tokenHash", "guestId", "expiresAt", "createdAt") VALUES ('s-ruim', 'hash-ruim', ${g.id}, '2026-01-01', '2026-01-02')`,
    );
  });

  it('número da reserva em maiúsculas ou minúsculas é o mesmo lançamento (ADR 0016)', async () => {
    const g = await newGuest();
    const body = { guestId: g.id, channel: 'PHONE', checkIn: '2026-02-27', checkOut: '2026-03-01', charges: [{ category: 'ROOM', amount: 1000 }] };
    const rs = await Promise.all([post('/stays', { ...body, externalRef: 'RES-9' }), post('/stays', { ...body, externalRef: 'res-9' })]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await prisma.stay.count({ where: { guestId: g.id } })).toBe(1);
  });

  it('quem indicou e foi excluído depois da leitura do check-out não recebe o bônus (ADR 0016)', async () => {
    const a = (await post('/guests', { ...ana }, {})).json() as { id: string; referralCode: string };
    const b = await newGuest({ email: 'indicado@exemplo.com', document: '111.444.777-35', referralCode: a.referralCode });
    const id = await openStay(b.id, 1000);
    const repo = new PrismaStayRepository(prisma);
    const data = await repo.loadCheckout(id);
    expect(data?.guest.referrerActive).toBe(true);
    await prisma.guest.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    const stale = Object.assign(Object.create(repo) as PrismaStayRepository, { loadCheckout: async () => data });
    await processCheckout({ stays: stale, now: () => clock }, id);
    expect(await ledger(a.id)).toBe(0);
    expect(await ledger(b.id)).toBe(1500); // 1.000 da estadia + 500 de boas-vindas
  });

  it('CPF repetido é recusado pelo índice único (P2002), inclusive em cadastros simultâneos', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) => post('/guests', { ...ana, email: `ana${i}@exemplo.com` }, {})),
    );
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(3);
    expect(await prisma.guest.count()).toBe(1);
  });

  it('o CPF não fica em texto puro no banco', async () => {
    const g = await newGuest();
    const row = await prisma.guest.findUniqueOrThrow({ where: { id: g.id } });
    expect(JSON.stringify(row)).not.toContain('52998224725');
    expect(row.documentLast4).toBe('4725');
  });
});

describe('check-out', () => {
  it('credita pontos e nível; dois check-outs simultâneos creditam uma única vez', async () => {
    const g = await newGuest();
    const s = await post('/stays', {
      guestId: g.id,
      channel: 'OTA',
      checkIn: '2026-02-26',
      checkOut: '2026-03-01',
      externalRef: 'SIM-1',
      charges: [{ category: 'ROOM', amount: 3500 }],
    });
    const url = `/stays/${s.json().id}/checkout`;
    const rs = await Promise.all([post(url), post(url), post(url), post(url)]);
    expect(rs.filter((r) => r.statusCode === 200).length).toBeGreaterThanOrEqual(1);
    expect(rs.every((r) => [200, 409].includes(r.statusCode))).toBe(true);
    expect(await ledger(g.id)).toBe(3500);
    expect(await prisma.pointsTransaction.count({ where: { guestId: g.id } })).toBe(1);
    const guest = await prisma.guest.findUniqueOrThrow({ where: { id: g.id }, include: { tier: true } });
    expect(guest.tier.name).toBe('Prata');
  });
});

describe('resgates e concorrência', () => {
  it('dois resgates simultâneos que juntos passam do saldo: só um passa e o saldo nunca fica negativo', async () => {
    const g = await newGuest();
    await stayDone(g.id, 1000);
    const reward = await newReward(800);
    const rs = await Promise.all(
      [1, 2, 3].map((i) => post('/redemptions', { guestId: g.id, rewardId: reward.id, requestId: `req-${i}-concorrente` })),
    );
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.statusCode !== 201).every((r) => r.statusCode === 409 || r.statusCode === 422)).toBe(true);
    expect(await ledger(g.id)).toBe(200);
    expect(await lotsLeft(g.id)).toBe(200);
  });

  it('o mesmo requestId em paralelo cria um único resgate', async () => {
    const g = await newGuest();
    await stayDone(g.id, 5000);
    const reward = await newReward(800);
    const body = { guestId: g.id, rewardId: reward.id, requestId: 'req-mesmo-pedido' };
    const rs = await Promise.all([post('/redemptions', body), post('/redemptions', body), post('/redemptions', body)]);
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(2);
    expect(new Set(rs.map((r) => r.json().id)).size).toBe(1);
    expect(await prisma.redemption.count()).toBe(1);
    expect(await ledger(g.id)).toBe(4200);
  });

  it('cancelar devolve os pontos; cancelar duas vezes ao mesmo tempo devolve uma só', async () => {
    const g = await newGuest();
    await stayDone(g.id, 1000);
    const reward = await newReward(800);
    const r = (await post('/redemptions', { guestId: g.id, rewardId: reward.id, requestId: 'req-cancelar-1' })).json();
    const rs = await Promise.all([post(`/redemptions/${r.id}/cancel`), post(`/redemptions/${r.id}/cancel`)]);
    expect(rs.filter((x) => x.statusCode === 200).length).toBeGreaterThanOrEqual(1);
    expect(rs.every((x) => [200, 409].includes(x.statusCode))).toBe(true);
    expect((await prisma.redemption.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('CANCELLED');
    expect(await prisma.pointsTransaction.count({ where: { guestId: g.id, idempotencyKey: `redeem-cancel:${r.id}` } })).toBeLessThanOrEqual(1);
    expect(await ledger(g.id)).toBe(1000);
    expect(await lotsLeft(g.id)).toBe(1000);
  });

  it('cancelar depois que o lote venceu não cria saldo fantasma', async () => {
    const g = await newGuest();
    await stayDone(g.id, 1000);
    const reward = await newReward(800);
    const r = (await post('/redemptions', { guestId: g.id, rewardId: reward.id, requestId: 'req-vencido-1' })).json();
    clock = new Date('2028-03-02T03:00:00Z'); // o lote de 1.000 já venceu
    headers = await loginAs('gerente'); // a sessão de 12 h também venceu
    const night = await runNightly({ repo: new PrismaMaintenanceRepository(prisma), now: () => clock });
    expect(night.errors).toBe(0);
    expect(await ledger(g.id)).toBe(0);
    const c = await post(`/redemptions/${r.id}/cancel`);
    expect(c.statusCode).toBe(200);
    expect(await ledger(g.id)).toBe(0);
    expect(await lotsLeft(g.id)).toBe(0);
  });
});

describe('rotina noturna', () => {
  it('vence lotes, é idempotente, gera avisos, rebaixa nível e apaga sessões vencidas', async () => {
    const g = await newGuest();
    await stayDone(g.id, 3500); // Prata; pontos vencem em 2028-03-01
    const repo = new PrismaMaintenanceRepository(prisma);

    clock = new Date('2027-12-20T00:00:00Z');
    const n1 = await runNightly({ repo, now: () => clock });
    expect(n1).toMatchObject({ noticesCreated: 1, errors: 0, tierReviews: 1, tierDowngrades: 1 });
    expect(n1.sessionsPurged).toBe(1); // a sessão de 12 h do gerente, vencida em 2026
    expect(await prisma.session.count()).toBe(0);
    expect((await runNightly({ repo, now: () => clock })).noticesCreated).toBe(0);

    clock = new Date('2028-03-02T03:00:00Z');
    const n2 = await runNightly({ repo, now: () => clock });
    expect(n2).toMatchObject({ expiredLots: 1, expiredPoints: 3500, errors: 0 });
    expect(await ledger(g.id)).toBe(0);
    expect((await runNightly({ repo, now: () => clock })).expiredLots).toBe(0);
    const g2 = await prisma.guest.findUniqueOrThrow({ where: { id: g.id }, include: { tier: true } });
    expect(g2.tier.rank).toBe(0);
  });

  it('resgate durante a rotina noturna: nunca vence pontos já gastos', async () => {
    const g = await newGuest();
    await stayDone(g.id, 1000);
    const reward = await newReward(800);
    clock = new Date('2028-03-02T03:00:00Z');
    headers = await loginAs('gerente');
    const repo = new PrismaMaintenanceRepository(prisma);
    const [night, red] = await Promise.all([
      runNightly({ repo, now: () => clock }),
      post('/redemptions', { guestId: g.id, rewardId: reward.id, requestId: 'req-durante-noite' }),
    ]);
    expect(night.errors).toBe(0);
    // Dois desfechos legítimos: o resgate venceu a corrida (201, sobram 200 que a rotina vence depois)
    // ou a rotina venceu (recusado, saldo 0). Nunca saldo fantasma nem lote vencido com pontos.
    expect([201, 409, 422]).toContain(red.statusCode);
    await runNightly({ repo, now: () => clock });
    expect(await ledger(g.id)).toBe(0);
    expect(await lotsLeft(g.id)).toBe(0);
    expect(await prisma.pointsTransaction.count({ where: { guestId: g.id, type: 'REDEEM' } })).toBe(red.statusCode === 201 ? 1 : 0);
  });
});

describe('login e funcionários', () => {
  it('login real, bloqueio por senhas erradas e sessão encerrada no logout', async () => {
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers });
    expect(me.json()).toMatchObject({ username: 'gerente', role: 'MANAGER' });
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'gerente', password: 'errada-errada-1' } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'gerente', password: PASSWORD } });
    expect(locked.statusCode).toBe(401);
    clock = new Date(clock.getTime() + 16 * 60_000);
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { username: 'gerente', password: PASSWORD } })).statusCode).toBe(200);
    expect((await post('/auth/logout')).statusCode).toBeLessThan(300);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers })).statusCode).toBe(401);
  });

  it('dois administradores se desativando ao mesmo tempo: sempre sobra um ativo', async () => {
    const deps = { repo: authRepo, audit: new PrismaAuditRepository(prisma), now: () => clock };
    await createOperator(deps, { username: 'admin1', name: 'Admin Um', role: 'ADMIN', password: PASSWORD });
    await createOperator(deps, { username: 'admin2', name: 'Admin Dois', role: 'ADMIN', password: PASSWORD });
    const [h1, h2] = await Promise.all([loginAs('admin1'), loginAs('admin2')]);
    const ids = Object.fromEntries((await prisma.operator.findMany()).map((o) => [o.username, o.id]));
    for (let round = 0; round < 3; round++) {
      await prisma.operator.updateMany({ where: { role: 'ADMIN' }, data: { active: true } });
      const rs = await Promise.all([
        app.inject({ method: 'POST', url: `/operators/${ids.admin2}/deactivate`, headers: h1 }),
        app.inject({ method: 'POST', url: `/operators/${ids.admin1}/deactivate`, headers: h2 }),
      ]);
      // Com 2 administradores, os dois pedidos juntos nunca podem ter sucesso (deixaria 0 ativos).
      expect(rs.filter((r) => r.statusCode === 204).length).toBeLessThanOrEqual(1);
      expect(await prisma.operator.count({ where: { role: 'ADMIN', active: true } })).toBeGreaterThanOrEqual(1);
    }
  });

  it('a auditoria não guarda dados pessoais do hóspede', async () => {
    const g = await newGuest();
    await stayDone(g.id, 1000);
    await app.inject({ method: 'GET', url: `/guests/${g.id}/balance`, headers });
    const logs = JSON.stringify(await prisma.auditLog.findMany());
    expect(logs).not.toContain('ana@exemplo.com');
    expect(logs).not.toContain('52998224725');
    expect(logs).not.toContain('529.982.247-25');
    expect(logs).not.toContain('529.982');
    expect(logs).not.toContain('Ana Souza');
  });
});

// --- Corridas entre operações diferentes sobre o mesmo hóspede/resgate ---------------------------------

const bia = { ...ana, fullName: 'Bia Lima', email: 'bia@exemplo.com', document: '111.444.777-35' };

async function openStay(guestId: string, amount: number) {
  const day = clock.toISOString().slice(0, 10);
  const prev = new Date(clock.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
  const s = await post('/stays', {
    guestId,
    channel: 'OTA',
    checkIn: prev,
    checkOut: day,
    externalRef: `PG-${++seq}`,
    charges: [{ category: 'ROOM', amount }],
  });
  expect(s.statusCode).toBe(201);
  return s.json().id as string;
}

describe('indicação e bônus de boas-vindas', () => {
  it('dois check-outs simultâneos de estadias diferentes do indicado pagam o bônus uma única vez', async () => {
    const a = await newGuest();
    const b = (await post('/guests', { ...bia, referralCode: (await prisma.guest.findUniqueOrThrow({ where: { id: a.id } })).referralCode }, {})).json();
    const [s1, s2] = [await openStay(b.id, 1000), await openStay(b.id, 1000)];
    const rs = await Promise.all([post(`/stays/${s1}/checkout`), post(`/stays/${s2}/checkout`)]);
    expect(rs.every((r) => r.statusCode === 200)).toBe(true);
    expect(await prisma.pointsTransaction.count({ where: { idempotencyKey: `welcome:${b.id}` } })).toBe(1);
    expect(await prisma.pointsTransaction.count({ where: { idempotencyKey: `referral:${b.id}` } })).toBe(1);
    expect(await ledger(b.id)).toBe(2000 + 500);
    expect(await ledger(a.id)).toBe(1000);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: b.id } })).welcomeBonusPending).toBe(0);
  });

  it('vários cadastros simultâneos com o mesmo código de indicação não pagam nada antes do check-out', async () => {
    const a = await newGuest();
    const code = (await prisma.guest.findUniqueOrThrow({ where: { id: a.id } })).referralCode;
    const docs = ['111.444.777-35', '390.533.447-05', '168.995.350-09', '935.411.347-80'];
    const rs = await Promise.all(
      docs.map((document, i) => post('/guests', { ...bia, email: `b${i}@exemplo.com`, document, referralCode: code }, {})),
    );
    expect(rs.every((r) => r.statusCode === 201)).toBe(true);
    expect(await prisma.guest.count({ where: { referredById: a.id } })).toBe(4);
    expect(await ledger(a.id)).toBe(0);
    expect(new Set((await prisma.guest.findMany()).map((g) => g.referralCode)).size).toBe(5);
  });
});

describe('resgate: ações simultâneas', () => {
  it('usar e cancelar ao mesmo tempo: só um vale, e o saldo bate com o estado final', async () => {
    for (let round = 0; round < 3; round++) {
      const g = await newGuest({ email: `r${round}@exemplo.com`, document: ['111.444.777-35', '390.533.447-05', '168.995.350-09'][round] });
      await stayDone(g.id, 1000);
      const reward = await newReward(800);
      const r = (await post('/redemptions', { guestId: g.id, rewardId: reward.id, requestId: `req-acao-${round}-xx` })).json();
      await post(`/redemptions/${r.id}/confirm`);
      const rs = await Promise.all([post(`/redemptions/${r.id}/use`), post(`/redemptions/${r.id}/cancel`)]);
      const final = (await prisma.redemption.findUniqueOrThrow({ where: { id: r.id } })).status;
      expect(['USED', 'CANCELLED']).toContain(final);
      expect(rs.filter((x) => x.statusCode === 200)).toHaveLength(1); // o outro é recusado
      expect(await ledger(g.id)).toBe(final === 'USED' ? 200 : 1000);
      expect(await lotsLeft(g.id)).toBe(await ledger(g.id));
    }
  });

  it('dois resgates simultâneos consomem os lotes por ordem de vencimento sem passar do saldo de cada lote', async () => {
    const g = await newGuest();
    await stayDone(g.id, 1000); // lote A vence primeiro
    clock = new Date('2026-04-01T12:00:00Z');
    headers = await loginAs('gerente');
    await stayDone(g.id, 1000); // lote B
    const reward = await newReward(800);
    const rs = await Promise.all(
      [1, 2].map((i) => post('/redemptions', { guestId: g.id, rewardId: reward.id, requestId: `req-fifo-${i}-xxxx` })),
    );
    expect(rs.map((r) => r.statusCode)).toEqual([201, 201]);
    const lots = await prisma.pointsTransaction.findMany({ where: { guestId: g.id, points: { gt: 0 } }, orderBy: { expiresAt: 'asc' } });
    expect(lots.map((l) => l.remaining)).toEqual([0, 400]); // o mais antigo foi todo consumido primeiro
    expect(await ledger(g.id)).toBe(400);
  });
});

describe('rotina noturna em corrida', () => {
  it('duas execuções simultâneas vencem cada lote uma única vez', async () => {
    const g = await newGuest();
    await stayDone(g.id, 3500);
    clock = new Date('2028-03-02T03:00:00Z');
    const repo = new PrismaMaintenanceRepository(prisma);
    const rs = await Promise.all([runNightly({ repo, now: () => clock }), runNightly({ repo, now: () => clock })]);
    expect(rs.every((r) => r.errors === 0)).toBe(true);
    expect(rs.reduce((n, r) => n + r.expiredPoints, 0)).toBe(3500);
    expect(await prisma.pointsTransaction.count({ where: { guestId: g.id, idempotencyKey: { startsWith: 'expire:' } } })).toBe(1);
    expect(await ledger(g.id)).toBe(0);
  });

  it('cancelar um resgate enquanto o lote vence: nenhum ponto fica sem dono', async () => {
    const g = await newGuest();
    await stayDone(g.id, 1000);
    const reward = await newReward(800);
    const r = (await post('/redemptions', { guestId: g.id, rewardId: reward.id, requestId: 'req-cancela-noite' })).json();
    clock = new Date('2028-03-02T03:00:00Z');
    headers = await loginAs('gerente');
    const repo = new PrismaMaintenanceRepository(prisma);
    const [night, cancel] = await Promise.all([runNightly({ repo, now: () => clock }), post(`/redemptions/${r.id}/cancel`)]);
    expect(night.errors).toBe(0);
    expect(cancel.statusCode).toBe(200);
    await runNightly({ repo, now: () => clock }); // a rodada seguinte fecha qualquer sobra
    expect(await ledger(g.id)).toBe(0);
    expect(await lotsLeft(g.id)).toBe(0);
  });

  it('revisão de nível em corrida com check-out: o hóspede termina no nível que os pontos justificam', async () => {
    const g = await newGuest();
    await stayDone(g.id, 3500); // Prata até 2027-03-01
    clock = new Date('2027-03-02T12:00:00Z');
    headers = await loginAs('gerente');
    const id = await openStay(g.id, 3500);
    const repo = new PrismaMaintenanceRepository(prisma);
    const [night, co] = await Promise.all([runNightly({ repo, now: () => clock }), post(`/stays/${id}/checkout`)]);
    expect(night.errors).toBe(0);
    expect(co.statusCode).toBe(200);
    const end = await prisma.guest.findUniqueOrThrow({ where: { id: g.id }, include: { tier: true } });
    expect(end.tier.name).toBe('Prata');
  });
});

describe('correções da revisão geral (ADR 0011)', () => {
  it('clique duplo ao lançar estadia sem identificador cria uma só', async () => {
    const g = await newGuest();
    const body = { guestId: g.id, channel: 'PHONE', checkIn: '2026-02-27', checkOut: '2026-03-01', charges: [{ category: 'ROOM', amount: 1000 }] };
    const rs = await Promise.all([post('/stays', body), post('/stays', body), post('/stays', body)]);
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.statusCode === 409)).toHaveLength(2);
    expect(await prisma.stay.count({ where: { guestId: g.id } })).toBe(1);
  });

  it('sem número e com número ao mesmo tempo, para o mesmo período: cria uma só (ADR 0012)', async () => {
    const g = await newGuest();
    const body = { guestId: g.id, channel: 'PHONE', checkIn: '2026-02-27', checkOut: '2026-03-01', charges: [{ category: 'ROOM', amount: 1000 }] };
    const rs = await Promise.all([post('/stays', body), post('/stays', { ...body, externalRef: 'MIX-PG' })]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await prisma.stay.count({ where: { guestId: g.id } })).toBe(1);
    // Com números diferentes, o mesmo período é aceito (dois quartos).
    const g2 = await newGuest({ email: 'quartos@example.com', document: '111.444.777-35' });
    const b2 = { ...body, guestId: g2.id };
    expect((await post('/stays', { ...b2, externalRef: 'Q-1' })).statusCode).toBe(201);
    expect((await post('/stays', { ...b2, externalRef: 'Q-2' })).statusCode).toBe(201);
  });

  it('hóspede excluído entre a leitura e a gravação do check-out não recebe pontos (ADR 0012)', async () => {
    const g = await newGuest();
    const id = await openStay(g.id, 1000);
    const repo = new PrismaStayRepository(prisma);
    const data = await repo.loadCheckout(id);
    expect(data?.guest.active).toBe(true);
    await prisma.guest.update({ where: { id: g.id }, data: { deletedAt: new Date() } });
    // A leitura antiga (hóspede ativo) chega à gravação: quem barra é a trava do banco.
    const stale = Object.assign(Object.create(repo) as PrismaStayRepository, { loadCheckout: async () => data });
    await expect(processCheckout({ stays: stale, now: () => clock }, id)).rejects.toBeInstanceOf(StayNotEligibleError);
    expect(await prisma.pointsTransaction.count({ where: { guestId: g.id } })).toBe(0);
    expect((await prisma.stay.findUniqueOrThrow({ where: { id } })).pointsProcessedAt).toBeNull();
  });

  it('estadia que terminou antes do cadastro é recusada', async () => {
    const g = await newGuest();
    const r = await post('/stays', { guestId: g.id, channel: 'PHONE', checkIn: '2026-02-20', checkOut: '2026-02-25', externalRef: 'ANT-1', charges: [{ category: 'ROOM', amount: 8000 }] });
    expect(r.statusCode).toBe(422);
    expect(await prisma.stay.count()).toBe(0);
  });

  it('dois check-outs simultâneos que juntos atingem o nível: o hóspede sobe', async () => {
    for (let round = 0; round < 3; round++) {
      const g = await newGuest({ email: `t${round}@exemplo.com`, document: ['111.444.777-35', '390.533.447-05', '168.995.350-09'][round] });
      const [s1, s2] = [await openStay(g.id, 2000), await openStay(g.id, 2000)];
      const rs = await Promise.all([post(`/stays/${s1}/checkout`), post(`/stays/${s2}/checkout`)]);
      expect(rs.every((r) => r.statusCode === 200)).toBe(true);
      const end = await prisma.guest.findUniqueOrThrow({ where: { id: g.id }, include: { tier: true } });
      expect(end.tier.name).toBe('Prata'); // 4.000 pontos-base ≥ 3.000
      expect(rs.some((r) => r.json().upgraded)).toBe(true);
    }
  });

  it('os lançamentos usam a data da aplicação, não a do banco', async () => {
    const g = await newGuest();
    await stayDone(g.id, 1000);
    const reward = await newReward(500);
    await post('/redemptions', { guestId: g.id, rewardId: reward.id, requestId: 'req-data-app-1' });
    const txs = await prisma.pointsTransaction.findMany({ where: { guestId: g.id } });
    expect(txs.length).toBe(2);
    for (const t of txs) expect(t.createdAt.toISOString()).toBe('2026-03-01T12:00:00.000Z');
    const guest = await prisma.guest.findUniqueOrThrow({ where: { id: g.id } });
    expect(guest.memberSince.toISOString()).toBe('2026-03-01T12:00:00.000Z');
  });
});

describe('área do hóspede (ADRs 0013 e 0014)', () => {
  const get = (url: string, h: Record<string, string>) => app.inject({ method: 'GET', url, headers: h });
  const post = async (url: string, payload?: object, h: Record<string, string> = headers) => {
    const r = await app.inject({ method: 'POST', url, payload: payload as object, headers: h });
    if (url === '/me/login/request') await flush();
    return r;
  };

  it('entra com o código e vê saldo, nível e vencimentos; o código não fica em texto no banco', async () => {
    const g = await newGuest();
    await stayDone(g.id, 3500);
    expect((await post('/me/login/request', { email: ana.email }, {})).statusCode).toBe(202);
    const code = sent[0].code;
    const row = await prisma.guestLoginCode.findFirstOrThrow({ where: { guestId: g.id } });
    expect(row.codeHash).not.toContain(code);
    const v = await post('/me/login/verify', { email: ana.email, code }, {});
    expect(v.statusCode).toBe(200);
    const h = { authorization: `Bearer ${v.json().token}` };
    expect((await prisma.guestSession.findFirstOrThrow({ where: { guestId: g.id } })).tokenHash).not.toBe(v.json().token);
    const me = (await get('/me', h)).json();
    expect(me).toMatchObject({
      points: { available: 3500 },
      tier: { name: 'Prata', validUntil: '2027-03-01' },
      expiring: [{ date: '2028-03-01', points: 3500 }],
    });
    expect((await get('/me/statement', h)).json()).toHaveLength(1);
  });

  it('20 palpites simultâneos: todos contam e o código queima depois de 5', async () => {
    await newGuest();
    await post('/me/login/request', { email: ana.email }, {});
    const right = sent[0].code;
    const wrong = Array.from({ length: 20 }, (_, i) => String((Number(right) + 1 + i) % 1_000_000).padStart(6, '0'));
    const rs = await Promise.all(wrong.map((code) => post('/me/login/verify', { email: ana.email, code }, {})));
    expect(rs.every((r) => r.statusCode === 401)).toBe(true);
    const row = await prisma.guestLoginCode.findFirstOrThrow();
    expect(row.attempts).toBe(5);
    expect(row.usedAt).not.toBeNull();
    expect((await post('/me/login/verify', { email: ana.email, code: right }, {})).statusCode).toBe(401);
  });

  it('10 pedidos de código simultâneos: no máximo 3 gravados; entrar com um queima os outros', async () => {
    const g = await newGuest();
    const rs = await Promise.all(Array.from({ length: 10 }, () => post('/me/login/request', { email: ana.email }, {})));
    expect(rs.every((r) => r.statusCode === 202)).toBe(true);
    expect(await prisma.guestLoginCode.count({ where: { guestId: g.id } })).toBe(3);
    expect(sent).toHaveLength(3);
    expect((await post('/me/login/verify', { email: ana.email, code: sent[0].code }, {})).statusCode).toBe(200);
    expect(await prisma.guestLoginCode.count({ where: { guestId: g.id, usedAt: null } })).toBe(0);
  });

  it('o mesmo código certo enviado 5 vezes ao mesmo tempo abre uma única sessão', async () => {
    const g = await newGuest();
    await post('/me/login/request', { email: ana.email }, {});
    const code = sent[0].code;
    const rs = await Promise.all(Array.from({ length: 5 }, () => post('/me/login/verify', { email: ana.email, code }, {})));
    expect(rs.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(await prisma.guestSession.count({ where: { guestId: g.id } })).toBe(1);
  });

  it('erros simultâneos espalhados por 3 códigos: o bloqueio diário vale (10 erros)', async () => {
    const g = await newGuest();
    for (let i = 0; i < 3; i++) await post('/me/login/request', { email: ana.email }, {});
    const codes = new Set(sent.map((s) => s.code));
    const wrong = Array.from({ length: 1000 }, (_, i) => String(i).padStart(6, '0')).filter((c) => !codes.has(c)).slice(0, 30);
    await Promise.all(wrong.map((code) => post('/me/login/verify', { email: ana.email, code }, {})));
    const total = (await prisma.guestLoginCode.aggregate({ where: { guestId: g.id }, _sum: { attempts: true } }))._sum.attempts;
    expect(total).toBe(10);
    expect((await post('/me/login/verify', { email: ana.email, code: sent[2].code }, {})).statusCode).toBe(401);
  });

  it('a rotina noturna apaga sessões de hóspede vencidas', async () => {
    const g = await newGuest();
    await post('/me/login/request', { email: ana.email }, {});
    await post('/me/login/verify', { email: ana.email, code: sent[0].code }, {});
    clock = new Date(clock.getTime() + 2 * 86_400_000);
    await runNightly({ repo: new PrismaMaintenanceRepository(prisma), now: () => clock });
    expect(await prisma.guestSession.count({ where: { guestId: g.id } })).toBe(0);
    expect(await prisma.guestLoginCode.count({ where: { guestId: g.id } })).toBe(0);
  });
});
