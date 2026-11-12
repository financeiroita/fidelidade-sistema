import { beforeEach, describe, expect, it } from 'vitest';
import { StayAlreadyProcessedError } from '../../src/application/ports';
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
let seq = 0;
async function complete(guestId: string, charges: object[], channel = 'DIRECT_WEBSITE') {
  const { id } = (await stay(guestId, charges, channel, { externalRef: `T-${++seq}` })).json();
  return (await checkout(id)).json();
}

beforeEach(() => {
  ctx = makeApp(undefined, () => new Date('2026-07-13T12:00:00Z'));
  headers = ctx.headers;
});

describe('segurança das rotas internas', () => {
  it('exige chave válida', async () => {
    const g = await signup(ana);
    const payload = { guestId: g.id, channel: 'PHONE', checkIn: '2026-07-10', checkOut: '2026-07-13', charges: [] };
    expect((await ctx.app.inject({ method: 'POST', url: '/stays', payload })).statusCode).toBe(401);
    const bad = { authorization: 'Bearer token-que-nao-existe-000000000000' };
    expect((await ctx.app.inject({ method: 'POST', url: '/stays', payload, headers: bad })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: '/stays', payload, headers: { 'x-api-key': 'antiga' } })).statusCode).toBe(401);
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

describe('estadia retroativa: limite de dias', () => {
  it('check-out há mais de 30 dias é recusado mesmo para membro antigo', async () => {
    let clock = new Date('2026-01-10T12:00:00Z');
    ctx = makeApp(undefined, () => clock);
    headers = ctx.headers;
    const g = await signup(ana); // membro desde jan/2026
    clock = new Date('2026-07-13T12:00:00Z');
    const old = await stay(g.id, [{ category: 'ROOM', amount: 1000 }], 'PHONE', { checkIn: '2026-06-01', checkOut: '2026-06-05', externalRef: 'X-1' });
    expect(old.statusCode).toBe(422);
    const ok = await stay(g.id, [{ category: 'ROOM', amount: 1000 }], 'PHONE', { checkIn: '2026-06-10', checkOut: '2026-06-13', externalRef: 'X-2' });
    expect(ok.statusCode).toBe(201); // exatamente 30 dias
  });
});

describe('check-out e o fuso do hotel', () => {
  it('às 21h de 12/07 em São Paulo (00h UTC de 13/07) a saída de 13/07 ainda não aconteceu', async () => {
    let clock = new Date('2026-07-12T12:00:00Z');
    ctx = makeApp(undefined, () => clock);
    headers = ctx.headers;
    const g = await signup(ana);
    const s = (await stay(g.id, [{ category: 'ROOM', amount: 1000 }], 'PHONE', { checkIn: '2026-07-12', checkOut: '2026-07-13', externalRef: 'TZ-1' })).json();
    clock = new Date('2026-07-13T00:30:00Z'); // 21h30 de 12/07 em São Paulo
    expect((await checkout(s.id)).statusCode).toBe(409);
    clock = new Date('2026-07-13T03:00:00Z'); // 00h de 13/07 em São Paulo
    expect((await checkout(s.id)).statusCode).toBe(200);
  });
});

describe('lançamento sem duplicar e com limites', () => {
  const room = [{ category: 'ROOM', amount: 1000 }];

  it('recusa o mesmo identificador externo e o mesmo hóspede/datas sem identificador', async () => {
    const g = await signup(ana);
    expect((await stay(g.id, room, 'PHONE', { externalRef: 'REC-001' })).statusCode).toBe(201);
    expect((await stay(g.id, room, 'PHONE', { externalRef: 'REC-001' })).statusCode).toBe(409);
    expect((await stay(g.id, room, 'PHONE', { externalRef: 'REC-002' })).statusCode).toBe(201);
    // Sem identificador, período sobreposto ao de outra estadia do hóspede = repetido.
    expect((await stay(g.id, room)).statusCode).toBe(409);
    expect((await stay(g.id, room, 'PHONE', { checkIn: '2026-07-12', checkOut: '2026-07-14' })).statusCode).toBe(409);
    // Encosta sem sobrepor (sai num dia, entra no mesmo dia): é outra estadia.
    expect((await stay(g.id, room, 'PHONE', { checkIn: '2026-07-13', checkOut: '2026-07-15' })).statusCode).toBe(201);
  });

  it('o número da reserva não diferencia maiúsculas de minúsculas (ADR 0016)', async () => {
    const g = await signup(ana);
    expect((await stay(g.id, room, 'PHONE', { externalRef: 'RES-123' })).statusCode).toBe(201);
    const again = await stay(g.id, room, 'PHONE', { externalRef: 'res-123' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('duplicate_stay');
    expect([...ctx.stays.stays.values()].map((s) => s.externalRef)).toEqual(['RES-123']);
  });

  it('estadia cancelada ou no-show não pontua e não bloqueia um novo lançamento do período', async () => {
    const g = await signup(ana);
    for (const status of ['CANCELLED', 'NO_SHOW'] as const) {
      const { id } = (await stay(g.id, room)).json(); // sem número
      ctx.stays.stays.get(id)!.status = status;
      const r = await checkout(id);
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('stay_not_eligible');
    }
    expect(ctx.stays.balance(g.id)).toBe(0);
    // As duas canceladas não contam como duplicata: o período pode ser lançado de novo.
    expect((await stay(g.id, room)).statusCode).toBe(201);
  });

  it('reserva corporativa ou por agência não ganha o bônus de reserva direta', async () => {
    const g = await signup(ana);
    let n = 0;
    for (const channel of ['CORPORATE', 'AGENCY']) {
      const { id } = (await stay(g.id, room, channel, { externalRef: `CH-${++n}` })).json();
      expect((await checkout(id)).json().earned).toBe(1000);
    }
  });

  it('a ordem não importa: lançada sem número e depois com número, a 2ª é recusada (ADR 0012)', async () => {
    const g = await signup(ana);
    expect((await stay(g.id, room)).statusCode).toBe(201);
    const second = await stay(g.id, room, 'PHONE', { externalRef: 'MIX-1' });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('duplicate_stay');
  });

  it('estadia anterior ao cadastro ou antiga demais é recusada (ADR 0004 e 0011)', async () => {
    const g = await signup(ana); // cadastro em 13/07/2026
    const before = await stay(g.id, room, 'PHONE', { checkIn: '2026-07-01', checkOut: '2026-07-05', externalRef: 'OLD-1' });
    expect(before.statusCode).toBe(422);
    expect(before.json().error).toBe('stay_out_of_period');
    // Quem se cadastra durante a estadia (ex.: no check-out) pontua por ela.
    expect((await stay(g.id, room, 'PHONE', { checkIn: '2026-07-10', checkOut: '2026-07-13', externalRef: 'DUR-1' })).statusCode).toBe(201);
  });

  it('limita valores, centavos e datas absurdas', async () => {
    const g = await signup(ana);
    expect((await stay(g.id, [{ category: 'ROOM', amount: 10.005 }])).statusCode).toBe(422);
    expect((await stay(g.id, [{ category: 'ROOM', amount: 200_000.01 }])).statusCode).toBe(422);
    const many = Array.from({ length: 4 }, () => ({ category: 'ROOM', amount: 150_000 }));
    expect((await stay(g.id, many)).statusCode).toBe(422);
    expect((await stay(g.id, room, 'PHONE', { checkIn: '0001-01-01' })).statusCode).toBe(422);
  });

  it('check-out de estadia que ainda não aconteceu é recusado (409)', async () => {
    const g = await signup(ana);
    const future = await stay(g.id, room, 'PHONE', { checkIn: '2026-12-01', checkOut: '2026-12-05' });
    expect((await checkout(future.json().id)).statusCode).toBe(409);
    expect(ctx.stays.balance(g.id)).toBe(0);
  });
});

describe('arredondamento em centavos', () => {
  it('0,60 + 0,30 + 0,10 somam 1 ponto (sem perder por ponto flutuante)', async () => {
    const g = await signup(ana);
    const r = await complete(g.id, [
      { category: 'ROOM', amount: 0.6 },
      { category: 'ROOM', amount: 0.3 },
      { category: 'ROOM', amount: 0.1 },
    ], 'OTA');
    expect(r.earned).toBe(1);
  });
});

describe('concorrência no mesmo hóspede', () => {
  it('se o commit perde a corrida por dados do hóspede, recalcula e não perde o crédito', async () => {
    const a = await signup(ana);
    const b = await signup({ ...bia, referralCode: a.referralCode });
    const { id } = (await stay(b.id, [{ category: 'ROOM', amount: 1000 }], 'OTA')).json();
    // Simula outro processamento que paga o bônus entre a leitura e o commit: 1ª tentativa falha.
    const real = ctx.stays.commitCheckout.bind(ctx.stays);
    let calls = 0;
    ctx.stays.commitCheckout = async (c) => {
      if (calls++ === 0) throw new StayAlreadyProcessedError();
      return real(c);
    };
    const r = (await checkout(id)).json();
    expect(r).toMatchObject({ alreadyProcessed: false, earned: 1000 });
    expect(calls).toBe(2);
    expect(ctx.stays.balance(b.id)).toBe(1500);
    expect(ctx.stays.balance(a.id)).toBe(1000);
  });

  it('manter o nível renova a validade', async () => {
    const g = await signup(ana);
    await complete(g.id, [{ category: 'ROOM', amount: 3500 }], 'OTA');
    const first = ctx.stays.tiers.get(g.id)!.validUntil!;
    expect(lastValidDay(first, 'America/Sao_Paulo')).toBe('2027-07-13');
    // Simula um nível conquistado há tempos, ainda válido mas perto de vencer.
    ctx.stays.tiers.set(g.id, { rank: 1, validUntil: new Date('2026-08-01T00:00:00Z') });
    await complete(g.id, [{ category: 'ROOM', amount: 100 }], 'OTA');
    expect(ctx.stays.tiers.get(g.id)!.rank).toBe(1);
    expect(lastValidDay(ctx.stays.tiers.get(g.id)!.validUntil!, 'America/Sao_Paulo')).toBe('2027-07-13');
  });

  it('nível vencido e parcialmente mantido: a resposta mostra o nível que os pontos garantem com esta estadia (ADR 0016)', async () => {
    const g = await signup(ana);
    ctx.stays.tiers.set(g.id, { rank: 2, validUntil: new Date('2026-07-01T00:00:00Z') }); // Ouro vencido
    const r = await complete(g.id, [{ category: 'ROOM', amount: 3500 }], 'OTA'); // chega a Prata
    expect(r).toMatchObject({ tier: 'Prata', upgraded: false });
  });

  it('nível vencido renovado no check-out aparece renovado na resposta (ADR 0012)', async () => {
    const g = await signup(ana);
    // Prata com validade vencida e a rotina noturna ainda não rodou; nenhum ponto nos últimos 12 meses.
    ctx.stays.tiers.set(g.id, { rank: 1, validUntil: new Date('2026-07-01T00:00:00Z') });
    const r = await complete(g.id, [{ category: 'ROOM', amount: 3500 }], 'OTA');
    expect(ctx.stays.tiers.get(g.id)).toMatchObject({ rank: 1 });
    expect(lastValidDay(ctx.stays.tiers.get(g.id)!.validUntil!, 'America/Sao_Paulo')).toBe('2027-07-13');
    expect(r).toMatchObject({ tier: 'Prata', upgraded: false });
  });

  it('nível vencido e não mantido: a resposta mostra o nível que o hóspede atinge', async () => {
    const g = await signup(ana);
    ctx.stays.tiers.set(g.id, { rank: 1, validUntil: new Date('2026-07-01T00:00:00Z') });
    const r = await complete(g.id, [{ category: 'ROOM', amount: 100 }], 'OTA');
    expect(r).toMatchObject({ tier: 'Bronze', upgraded: false });
  });
});

describe('hóspede excluído (LGPD)', () => {
  const room = [{ category: 'ROOM', amount: 1000 }];
  const remove = (id: string) => {
    ctx.guests.guests.find((g) => g.id === id)!.deletedAt = new Date('2026-07-13T10:00:00Z');
  };

  it('não recebe estadia nova nem pontos', async () => {
    const g = await signup(ana);
    const { id } = (await stay(g.id, room, 'OTA', { externalRef: 'DEL-1' })).json();
    remove(g.id);
    expect((await stay(g.id, room, 'OTA', { checkIn: '2026-07-01', checkOut: '2026-07-03', externalRef: 'DEL-2' })).statusCode).toBe(404);
    const r = await checkout(id);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('stay_not_eligible');
    expect(ctx.stays.balance(g.id)).toBe(0);
  });

  it('excluído entre a leitura e a gravação do check-out: nada é creditado', async () => {
    const g = await signup(ana);
    const { id } = (await stay(g.id, room, 'OTA', { externalRef: 'DEL-3' })).json();
    const real = ctx.stays.loadCheckout.bind(ctx.stays);
    ctx.stays.loadCheckout = async (s) => {
      const d = await real(s);
      remove(g.id);
      return d;
    };
    expect((await checkout(id)).statusCode).toBe(409);
    expect(ctx.stays.balance(g.id)).toBe(0);
  });

  it('quem indicou e foi excluído não recebe o bônus de indicação', async () => {
    const a = await signup(ana);
    const b = await signup({ ...bia, referralCode: a.referralCode });
    remove(a.id);
    await complete(b.id, room, 'OTA');
    expect(ctx.stays.balance(a.id)).toBe(0);
    expect(ctx.stays.balance(b.id)).toBeGreaterThan(0);
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
    expect(ctx.stays.transactions.every((t) => t.expiresAt?.toISOString() === '2028-07-14T03:00:00.000Z')).toBe(true);
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

  it('o multiplicador não acelera a subida: 3.000 pontos base só pagam o Ouro em 8.000 base', async () => {
    const g = await signup(ana);
    await complete(g.id, [{ category: 'ROOM', amount: 3500 }], 'OTA'); // Prata (3.500 base)
    // Prata rende 1,25x: ganha 5.000 pontos, mas só 4.000 contam para o nível (total base 7.500)
    const r = await complete(g.id, [{ category: 'ROOM', amount: 4000 }], 'OTA');
    expect(r).toMatchObject({ earned: 5000, tier: 'Prata', upgraded: false });
    // Com pontos multiplicados somaria 3.500 + 5.000 = 8.500 e já seria Ouro.
    const r2 = await complete(g.id, [{ category: 'ROOM', amount: 500 }], 'OTA'); // base 8.000
    expect(r2).toMatchObject({ tier: 'Ouro', upgraded: true });
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
    expect(ctx.guests.guests.find((g) => g.id === b.id)!.welcomeBonusPending).toBe(500);
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

describe('nível vencido no check-out: os três casos (ADR 0016)', () => {
  it('pontos garantem o mesmo nível: renova; garantem um nível acima: sobe', async () => {
    const g = await signup(ana);
    ctx.stays.tiers.set(g.id, { rank: 1, validUntil: new Date('2026-07-01T00:00:00Z') }); // Prata vencida
    const same = await complete(g.id, [{ category: 'ROOM', amount: 3500 }], 'OTA');
    expect(same).toMatchObject({ tier: 'Prata', upgraded: false });
    const h = await signup(bia);
    ctx.stays.tiers.set(h.id, { rank: 1, validUntil: new Date('2026-07-01T00:00:00Z') });
    const up = await complete(h.id, [{ category: 'ROOM', amount: 9000 }], 'OTA');
    expect(up).toMatchObject({ tier: 'Ouro', upgraded: true });
  });

  it('reprocessar o check-out responde com o nível que vale agora', async () => {
    const g = await signup(ana);
    const { id } = (await stay(g.id, [{ category: 'ROOM', amount: 3500 }], 'OTA', { externalRef: 'REP-1' })).json();
    await checkout(id);
    ctx.stays.tiers.set(g.id, { rank: 2, validUntil: new Date('2026-07-01T00:00:00Z') }); // Ouro vencido
    expect((await checkout(id)).json()).toMatchObject({ alreadyProcessed: true, tier: 'Prata' });
  });
});
