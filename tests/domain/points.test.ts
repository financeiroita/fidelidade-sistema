import { describe, expect, it } from 'vitest';
import { loyaltyConfig as cfg } from '../../src/config/loyalty';
import { calculateStayPoints, totalPoints } from '../../src/domain/points/earn';
import { consumeFifo, expirationDate, findExpired } from '../../src/domain/points/expiry';
import { addMonths } from '../../src/domain/time';
import { resolveTier } from '../../src/domain/tiers/tier';

const bronze = cfg.tiers[0];
const ouro = cfg.tiers[2];

describe('acúmulo', () => {
  it('diária + A&B, nível Bronze', () => {
    const l = calculateStayPoints(
      { isDirect: false, charges: [{ category: 'ROOM', amount: 2000 }, { category: 'FNB', amount: 500 }] },
      bronze,
      cfg,
    );
    expect(totalPoints(l)).toBe(2500);
  });
  it('multiplicador Ouro 1,5', () => {
    const l = calculateStayPoints({ isDirect: false, charges: [{ category: 'ROOM', amount: 1000 }] }, ouro, cfg);
    expect(totalPoints(l)).toBe(1500);
  });
  it('reserva direta dá +20% sobre a diária base, sem qualificar', () => {
    const l = calculateStayPoints({ isDirect: true, charges: [{ category: 'ROOM', amount: 1000 }] }, bronze, cfg);
    expect(totalPoints(l)).toBe(1200);
    expect(l.find((x) => x.kind === 'DIRECT_BONUS')?.qualifyingPts).toBe(0);
  });
  it('para o nível conta só o valor base, sem multiplicador', () => {
    const l = calculateStayPoints(
      { isDirect: false, charges: [{ category: 'ROOM', amount: 1000 }, { category: 'EVENTS', amount: 1000 }] },
      ouro,
      cfg,
    );
    expect(totalPoints(l)).toBe(2250); // (1000 + 500) * 1,5
    expect(l.reduce((s, x) => s + x.qualifyingPts, 0)).toBe(1500);
  });
  it('eventos 0,5 e outros 0; estorno não gera negativo', () => {
    const l = calculateStayPoints(
      {
        isDirect: false,
        charges: [
          { category: 'EVENTS', amount: 1000 },
          { category: 'OTHER', amount: 300 },
          { category: 'SPA', amount: -50 },
        ],
      },
      bronze,
      cfg,
    );
    expect(totalPoints(l)).toBe(500);
  });
});

describe('níveis', () => {
  it.each([
    [0, 'Bronze'],
    [2999, 'Bronze'],
    [3000, 'Prata'],
    [8000, 'Ouro'],
    [25000, 'Diamante'],
  ])('%i pts → %s', (p, n) => {
    expect(resolveTier(p, cfg).name).toBe(n);
  });
});

describe('expiração', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  it('soma meses sem estourar o fim do mês', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonths(new Date('2026-02-28T00:00:00Z'), 12).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(addMonths(new Date('2028-02-29T00:00:00Z'), 24).toISOString()).toBe('2030-02-28T00:00:00.000Z');
  });
  it('expira em 24 meses', () => {
    expect(expirationDate(new Date('2024-06-01T12:00:00Z'), cfg).toISOString()).toBe('2026-06-02T03:00:00.000Z');
  });
  it('consumo FIFO por vencimento', () => {
    const lots = [
      { id: 'b', remaining: 100, expiresAt: new Date('2027-01-01') },
      { id: 'a', remaining: 50, expiresAt: new Date('2026-08-01') },
    ];
    expect(consumeFifo(lots, 120, now)).toEqual([
      { lotId: 'a', points: 50 },
      { lotId: 'b', points: 70 },
    ]);
  });
  it('saldo insuficiente lança erro e lote vencido não conta', () => {
    const lots = [{ id: 'x', remaining: 100, expiresAt: new Date('2026-05-01') }];
    expect(() => consumeFifo(lots, 10, now)).toThrow();
    expect(findExpired(lots, now)).toEqual([{ lotId: 'x', points: 100 }]);
  });
});
