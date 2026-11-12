// Testes contra um PostgreSQL de verdade: travas de linha, restrições do banco, erros P2002,
// SQL cru do Prisma e concorrência. Os testes em memória não conseguem provar nada disso.
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../src/api/app';
import { createOperator } from '../../src/application/auth';
import { runNightly } from '../../src/application/maintenance';
import { loyaltyConfig } from '../../src/config/loyalty';
import { PrismaAuditRepository, PrismaAuthRepository } from '../../src/infra/prisma/authRepository';
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
    'TRUNCATE "AuditLog","Session","Operator","ExpiryNotice","RedemptionLot","Redemption","Reward","PointsTransaction","StayCharge","Stay","Guest" RESTART IDENTITY CASCADE',
  );
  clock = new Date('2026-03-01T12:00:00Z');
  const now = () => clock;
  authRepo = new PrismaAuthRepository(prisma);
  const auditRepo = new PrismaAuditRepository(prisma);
  app = buildApp(
    {
      signup: { repo: new PrismaGuestRepository(prisma), documentSecret: SECRET, now },
      loyalty: { stays: new PrismaStayRepository(prisma), now },
      rewards: { repo: new PrismaRewardRepository(prisma), now },
      auth: { repo: authRepo, audit: auditRepo, now },
    },
    { limits: { login: HIGH, password: HIGH, guests: HIGH } },
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
    clock = new Date('2028-03-02T00:00:00Z'); // o lote de 1.000 já venceu
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

    clock = new Date('2028-03-02T00:00:00Z');
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
    clock = new Date('2028-03-02T00:00:00Z');
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
    clock = new Date('2028-03-02T00:00:00Z');
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
    clock = new Date('2028-03-02T00:00:00Z');
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
