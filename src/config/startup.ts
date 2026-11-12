// Validações de partida do servidor, sem efeitos colaterais (testáveis). Quem chama é src/server.ts,
// que mostra o erro e encerra. Decisões: ADRs 0012, 0014 e 0016.
import { isIP } from 'node:net';

type Env = Record<string, string | undefined>;
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Exige tamanho mínimo e variedade de caracteres (rejeita "aaaa...", "1234..."). */
export const strongSecret = (v: string | undefined, minLen: number): v is string =>
  !!v && v.length >= minLen && new Set(v).size >= 12;

/**
 * IP (v4/v6) com faixa opcional (/n). Recusa faixas largas demais (menos de /8 em IPv4 e de /32 em
 * IPv6): somadas, elas equivaleriam a "confiar em todos".
 */
export function validProxyAddr(v: string): boolean {
  const [ip, prefix, extra] = v.split('/');
  const kind = isIP(ip);
  if (!kind || extra !== undefined) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const n = Number(prefix);
  if (kind === 4) return n >= 8 && n <= 32;
  // IPv4 escrito como IPv6 (::ffff:10.0.0.0/104): vale a regra do IPv4, ou seja, pelo menos 96 + 8.
  // Sem isso, ::ffff:0.0.0.0/96 confiaria em todo o IPv4 (ADR 0016).
  const embedsIpv4 = ip.includes('.') || /^(0*:)*:?ffff:/i.test(ip) || /^::ffff/i.test(ip);
  return embedsIpv4 ? n >= 104 && n <= 128 : n >= 32 && n <= 128;
}

/** Endereços dos proxies confiáveis (TRUST_PROXY_ADDRS), ou false se não houver proxy. */
export function proxyAddrs(env: Env): Checked<string[] | false> {
  for (const old of ['TRUST_PROXY', 'TRUST_PROXY_HOPS']) {
    if (env[old] !== undefined) {
      return {
        ok: false,
        error: `${old} foi substituído por TRUST_PROXY_ADDRS (endereços dos seus proxies, ex.: 127.0.0.1). Ver README.`,
      };
    }
  }
  const v = env.TRUST_PROXY_ADDRS?.trim();
  if (!v) return { ok: true, value: false };
  const list = v.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((a) => !validProxyAddr(a));
  if (bad.length > 0) {
    return {
      ok: false,
      error: `TRUST_PROXY_ADDRS inválido: ${bad.join(', ')}. Use IPs ou faixas de no mínimo /8 (ex.: 127.0.0.1,10.0.0.0/8).`,
    };
  }
  return { ok: true, value: list };
}

/**
 * Como o código de acesso do hóspede é entregue (GUEST_CODE_DELIVERY).
 * - sem a variável: 'off' (o login do hóspede responde 503);
 * - 'console': só num computador de teste, ou seja, com NODE_ENV=development declarado E o banco
 *   nesta máquina. Um servidor de verdade que não declare nada é recusado.
 */
export function guestCodeDelivery(env: Env): Checked<'off' | 'console'> {
  const mode = env.GUEST_CODE_DELIVERY;
  if (!mode) return { ok: true, value: 'off' };
  if (mode !== 'console') {
    return { ok: false, error: 'GUEST_CODE_DELIVERY inválido. Valores aceitos hoje: console (só para testes).' };
  }
  let dbHost = '';
  try {
    dbHost = new URL(env.DATABASE_URL ?? '').hostname;
  } catch {
    dbHost = '';
  }
  const localDb = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(dbHost);
  if (env.NODE_ENV !== 'development' || !localDb) {
    return {
      ok: false,
      error: 'GUEST_CODE_DELIVERY=console é só para testes: exige NODE_ENV=development e o banco nesta máquina.',
    };
  }
  return { ok: true, value: 'console' };
}
