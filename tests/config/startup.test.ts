import { describe, expect, it } from 'vitest';
import { guestCodeDelivery, proxyAddrs, strongSecret, validProxyAddr } from '../../src/config/startup';
import { loyaltyConfig } from '../../src/config/loyalty';
import { expirationDate, lastValidDay } from '../../src/domain/points/expiry';
import { planNotices } from '../../src/domain/points/maintenance';
import { startOfLocalDay } from '../../src/domain/time';
import { effectiveTierRank } from '../../src/domain/tiers/tier';

describe('validações de partida do servidor (ADRs 0012, 0014, 0016)', () => {
  it('chave do CPF: exige tamanho e variedade', () => {
    expect(strongSecret(undefined, 32)).toBe(false);
    expect(strongSecret('a'.repeat(40), 32)).toBe(false);
    expect(strongSecret('curta-mas-variada-123', 32)).toBe(false);
    expect(strongSecret('uma-chave-bem-variada-com-mais-de-32-caracteres!', 32)).toBe(true);
  });

  it('proxy: aceita endereços e faixas estreitas; recusa faixas largas e lixo', () => {
    for (const ok of ['127.0.0.1', '10.0.0.0/8', '192.168.1.0/24', '::1', 'fd00::/32']) {
      expect(validProxyAddr(ok), ok).toBe(true);
    }
    for (const bad of ['0.0.0.0/0', '0.0.0.0/1', '128.0.0.0/1', '10.0.0.0/7', '::/0', '::/16', 'proxy.local', '10.0.0.1/33', '10.0.0.1/8/8', '']) {
      expect(validProxyAddr(bad), bad).toBe(false);
    }
  });

  it('proxy: sem variável = sem proxy; variáveis antigas e endereços inválidos param o servidor', () => {
    expect(proxyAddrs({})).toEqual({ ok: true, value: false });
    expect(proxyAddrs({ TRUST_PROXY_ADDRS: ' 127.0.0.1 , 10.0.0.0/8 ' })).toEqual({ ok: true, value: ['127.0.0.1', '10.0.0.0/8'] });
    expect(proxyAddrs({ TRUST_PROXY: 'true' }).ok).toBe(false);
    expect(proxyAddrs({ TRUST_PROXY_HOPS: '1' }).ok).toBe(false);
    expect(proxyAddrs({ TRUST_PROXY_ADDRS: '127.0.0.1,0.0.0.0/1' }).ok).toBe(false);
  });

  it('código do hóspede no terminal: só com NODE_ENV=development e banco nesta máquina', () => {
    const local = 'postgresql://u:p@localhost:5432/db';
    expect(guestCodeDelivery({})).toEqual({ ok: true, value: 'off' });
    expect(guestCodeDelivery({ GUEST_CODE_DELIVERY: 'console', NODE_ENV: 'development', DATABASE_URL: local })).toEqual({ ok: true, value: 'console' });
    // Servidor único que não declara nada: recusado.
    expect(guestCodeDelivery({ GUEST_CODE_DELIVERY: 'console', DATABASE_URL: local }).ok).toBe(false);
    expect(guestCodeDelivery({ GUEST_CODE_DELIVERY: 'console', NODE_ENV: 'production', DATABASE_URL: local }).ok).toBe(false);
    expect(guestCodeDelivery({ GUEST_CODE_DELIVERY: 'console', NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@db.hotel.com/db' }).ok).toBe(false);
    expect(guestCodeDelivery({ GUEST_CODE_DELIVERY: 'console', NODE_ENV: 'development' }).ok).toBe(false);
    expect(guestCodeDelivery({ GUEST_CODE_DELIVERY: 'email' }).ok).toBe(false);
  });
});

describe('datas no fuso do hotel (ADR 0016)', () => {
  const tz = loyaltyConfig.timeZone;

  it('o dia do hotel começa às 03:00 UTC', () => {
    expect(startOfLocalDay('2026-11-12', tz).toISOString()).toBe('2026-11-12T03:00:00.000Z');
  });

  it('pontos valem até o fim do dia do hotel em que completam 24 meses', () => {
    // Crédito às 11h de 12/11/2026 em São Paulo.
    const exp = expirationDate(new Date('2026-11-12T14:00:00Z'), loyaltyConfig);
    expect(exp.toISOString()).toBe('2028-11-13T03:00:00.000Z');
    expect(lastValidDay(exp, tz)).toBe('2028-11-12');
    // Crédito às 22h de 12/11 em São Paulo (já 13/11 em UTC): ainda conta como dia 12 do hotel.
    expect(lastValidDay(expirationDate(new Date('2026-11-13T01:00:00Z'), loyaltyConfig), tz)).toBe('2028-11-12');
  });

  it('o aviso de vencimento traz o último dia para usar os pontos, no calendário do hotel', () => {
    const lot = { id: 'l1', guestId: 'g1', remaining: 500, expiresAt: new Date('2028-11-13T03:00:00Z'), guestActive: true };
    const [notice] = planNotices([lot], new Date('2028-10-20T12:00:00Z'), [90, 30], tz);
    expect(notice).toMatchObject({ guestId: 'g1', windowDays: 30, points: 500 });
    expect(notice.expiresOn.toISOString()).toBe('2028-11-12T00:00:00.000Z');
  });
});

describe('nível que vale agora (ADR 0016)', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const future = new Date('2027-01-01T00:00:00Z');
  const past = new Date('2026-11-01T00:00:00Z');

  it('nível dentro da validade vale como está; vencido vale o que os pontos garantem', () => {
    expect(effectiveTierRank(2, future, 0, now, loyaltyConfig)).toBe(2);
    expect(effectiveTierRank(2, past, 3500, now, loyaltyConfig)).toBe(1);
    expect(effectiveTierRank(2, past, 0, now, loyaltyConfig)).toBe(0);
    expect(effectiveTierRank(1, null, 9000, now, loyaltyConfig)).toBe(2);
    expect(effectiveTierRank(0, null, 9000, now, loyaltyConfig)).toBe(0); // Bronze só sobe no check-out
  });
});

describe('ajustes da auditoria do ADR 0016', () => {
  const tz = loyaltyConfig.timeZone;

  it('proxy: IPv4 escrito como IPv6 segue a regra do /8', () => {
    for (const bad of ['::ffff:0.0.0.0/96', '::ffff:0.0.0.0/97', '::ffff:0:0/96', '0:0:0:0:0:ffff:0:0/100', '::0.0.0.0/96']) {
      expect(validProxyAddr(bad), bad).toBe(false);
    }
    for (const ok of ['::ffff:10.0.0.0/104', '::ffff:127.0.0.1', '::ffff:7f00:1/128']) {
      expect(validProxyAddr(ok), ok).toBe(true);
    }
  });

  it('horário de verão que começa à meia-noite: o dia começa no primeiro instante que existe', () => {
    // 04/11/2018 em São Paulo: o relógio pulou de 00:00 para 01:00 (03:00Z).
    expect(startOfLocalDay('2018-11-04', tz).toISOString()).toBe('2018-11-04T03:00:00.000Z');
    expect(startOfLocalDay('2026-09-06', 'America/Santiago').toISOString()).toBe('2026-09-06T04:00:00.000Z');
    // E um dia comum continua igual.
    expect(startOfLocalDay('2018-11-05', tz).toISOString()).toBe('2018-11-05T02:00:00.000Z');
  });

  it('créditos do mesmo dia do hotel vencem no mesmo dia, mesmo perto da meia-noite UTC', () => {
    const morning = expirationDate(new Date('2026-02-28T14:00:00Z'), loyaltyConfig); // 11h de 28/02
    const night = expirationDate(new Date('2026-03-01T01:00:00Z'), loyaltyConfig); // 22h de 28/02
    expect(lastValidDay(morning, tz)).toBe('2028-02-28');
    expect(night.getTime()).toBe(morning.getTime());
  });
});
