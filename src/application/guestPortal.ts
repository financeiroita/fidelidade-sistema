import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { loyaltyConfig, type LoyaltyConfig } from '../config/loyalty';
import { addMonths, localDate } from '../domain/time';
import { resolveTier } from '../domain/tiers/tier';
import { hashToken, newSessionToken } from '../infra/security/token';
import {
  GuestLoginUnavailableError,
  GuestNotFoundError,
  InvalidLoginCodeError,
  type GuestCodeSender,
  type GuestPortalRepository,
  type RewardRepository,
  type StayRepository,
} from './ports';

/** Regras do acesso do hóspede (ADRs 0013 e 0014). */
export const guestLoginPolicy = {
  codeTtlMinutes: 10,
  /** Tentativas por código; depois o código é queimado. */
  maxAttempts: 5,
  /** Códigos por hóspede: no máximo 3 a cada 15 minutos e 10 por dia (adivinhação e spam no e-mail). */
  maxCodesPerWindow: 3,
  codeWindowMinutes: 15,
  maxCodesPerDay: 10,
  /**
   * Erros de código por hóspede em 24 h, somando todos os códigos. Ao chegar aqui, o acesso pela
   * internet fica bloqueado até o fim das 24 h (invadir vale mais que o incômodo; ver ADR 0014).
   */
  maxFailuresPerDay: 10,
  sessionHours: 24,
};

export interface GuestPortalDeps {
  repo: GuestPortalRepository;
  rewards: RewardRepository;
  stays: StayRepository;
  /** Segredo do servidor para o hash do código (sem ele, quem lê o banco acharia o código em 1 s). */
  codeSecret: string;
  /** Sem `sender`, o acesso por código fica desligado (503). */
  sender?: GuestCodeSender;
  config?: LoyaltyConfig;
  now?: () => Date;
  /** Falha no pedido ou no envio do código (só o tipo do erro; nunca o e-mail). */
  onSendError?: (errName: string) => void;
  /** Recebe a tarefa de segundo plano do pedido de código (os testes esperam por ela). */
  track?: (task: Promise<void>) => void;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Usado quando o e-mail não existe: a verificação faz o mesmo caminho no banco e não acha nada. */
const NO_GUEST = '00000000-0000-0000-0000-000000000000';
const clock = (deps: GuestPortalDeps) => (deps.now ?? (() => new Date()))();
const codeHash = (secret: string, guestId: string, code: string) =>
  createHmac('sha256', secret).update(`guest-code:${guestId}:${code}`).digest('hex');
const firstName = (fullName: string) => fullName.trim().split(/\s+/)[0];
const errName = (e: unknown) => (e instanceof Error ? e.name : 'Error');

/**
 * Pede um código de acesso. A resposta (202) sai antes de qualquer consulta: igual, e no mesmo
 * tempo, exista ou não o cadastro. Consulta, gravação e envio rodam em segundo plano.
 */
export function requestLoginCode(deps: GuestPortalDeps, email: string): void {
  const sender = deps.sender;
  if (!sender) throw new GuestLoginUnavailableError();
  const task = (async () => {
    const now = clock(deps);
    const guest = await deps.repo.findActiveGuestByEmail(email.trim().toLowerCase());
    if (!guest) return;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const issued = await deps.repo.issueLoginCode(
      {
        id: randomUUID(),
        guestId: guest.id,
        codeHash: codeHash(deps.codeSecret, guest.id, code),
        expiresAt: new Date(now.getTime() + guestLoginPolicy.codeTtlMinutes * MIN),
        now,
      },
      [
        { since: new Date(now.getTime() - guestLoginPolicy.codeWindowMinutes * MIN), max: guestLoginPolicy.maxCodesPerWindow },
        { since: new Date(now.getTime() - DAY), max: guestLoginPolicy.maxCodesPerDay },
      ],
    );
    if (!issued) return; // pedidos demais: silencioso
    await sender.send({ email: guest.email, firstName: firstName(guest.fullName) }, code);
  })().catch((e: unknown) => deps.onSendError?.(errName(e)));
  deps.track?.(task);
}

/** Troca e-mail + código por uma sessão do hóspede. */
export async function verifyLoginCode(
  deps: GuestPortalDeps,
  email: string,
  code: string,
): Promise<{ token: string; expiresAt: Date }> {
  if (!deps.sender) throw new GuestLoginUnavailableError();
  const now = clock(deps);
  const guest = await deps.repo.findActiveGuestByEmail(email.trim().toLowerCase());
  if (!/^\d{6}$/.test(code)) throw new InvalidLoginCodeError();
  // E-mail desconhecido percorre o mesmo caminho (com um id que não existe), para não responder mais rápido.
  const guestId = guest?.id ?? NO_GUEST;
  const ok = await deps.repo.verifyLoginCode(guestId, codeHash(deps.codeSecret, guestId, code), now, {
    maxAttemptsPerCode: guestLoginPolicy.maxAttempts,
    maxFailures: guestLoginPolicy.maxFailuresPerDay,
    failuresSince: new Date(now.getTime() - DAY),
  });
  if (!ok || !guest) throw new InvalidLoginCodeError();
  const { token, hash } = newSessionToken();
  const expiresAt = new Date(now.getTime() + guestLoginPolicy.sessionHours * 60 * MIN);
  await deps.repo.createGuestSession({ tokenHash: hash, guestId: guest.id, expiresAt, now });
  return { token, expiresAt };
}

/** Comparação em tempo constante de dois hashes hex (usada pelos repositórios). */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function authenticateGuest(deps: GuestPortalDeps, token: string): Promise<string | null> {
  const s = await deps.repo.findGuestSession(hashToken(token));
  if (!s || s.expiresAt <= clock(deps)) return null;
  return s.guestId;
}

export const logoutGuest = (deps: GuestPortalDeps, token: string) => deps.repo.deleteGuestSession(hashToken(token));

/** Nível que vale agora: nível guardado vencido (rotina noturna ainda não rodou) vale pelos pontos. */
function effectiveRank(rank: number, validUntil: Date | null, qualifying: number, now: Date, cfg: LoyaltyConfig) {
  const expired = rank > 0 && (!validUntil || validUntil <= now);
  return expired ? resolveTier(qualifying, cfg).rank : rank;
}

/** Resumo da conta: nível, saldo, progresso para o próximo nível e próximos vencimentos. */
export async function getGuestSummary(deps: GuestPortalDeps, guestId: string) {
  const cfg = deps.config ?? loyaltyConfig;
  const now = clock(deps);
  const account = await deps.repo.getAccount(guestId);
  if (!account) throw new GuestNotFoundError();
  const [balance, qualifying, expiring] = await Promise.all([
    deps.rewards.getBalance(guestId, now),
    deps.stays.qualifyingPointsSince(guestId, addMonths(now, -cfg.tierWindowMonths)),
    deps.repo.upcomingExpirations(guestId, now, 30),
  ]);
  if (!balance) throw new GuestNotFoundError();
  const rank = effectiveRank(account.tierRank, account.tierValidUntil, qualifying, now, cfg);
  const tier = cfg.tiers.find((t) => t.rank === rank) ?? cfg.tiers[0];
  const next = cfg.tiers.find((t) => t.rank === rank + 1) ?? null;
  const day = (d: Date) => localDate(d, cfg.timeZone);
  // Junta os lotes que vencem no mesmo dia do hotel e mostra só os 3 próximos dias.
  const byDay = new Map<string, number>();
  for (const e of expiring) byDay.set(day(e.expiresAt), (byDay.get(day(e.expiresAt)) ?? 0) + e.points);
  return {
    firstName: firstName(account.fullName),
    memberSince: day(account.memberSince),
    referralCode: account.referralCode,
    tier: {
      name: tier.name,
      multiplier: tier.multiplier,
      // Validade só quando o nível guardado é o que vale (Bronze não vence).
      validUntil: rank > 0 && rank === account.tierRank && account.tierValidUntil ? day(account.tierValidUntil) : null,
    },
    points: { available: balance.available, pendingWelcome: balance.pendingWelcome },
    progress: {
      windowMonths: cfg.tierWindowMonths,
      qualifyingPts: qualifying,
      currentMin: tier.minQualifyingPts,
      nextTier: next ? { name: next.name, minQualifyingPts: next.minQualifyingPts, missing: Math.max(0, next.minQualifyingPts - qualifying) } : null,
    },
    expiring: [...byDay.entries()].slice(0, 3).map(([date, points]) => ({ date, points })),
  };
}

export async function getGuestStatement(deps: GuestPortalDeps, guestId: string, limit: number) {
  const rows = await deps.rewards.getStatement(guestId, limit);
  return rows.map((r) => ({ at: r.at, type: r.type, points: r.points, note: r.note }));
}

/** Catálogo com o que o hóspede já pode resgatar (o resgate é feito na recepção). */
export async function getGuestRewards(deps: GuestPortalDeps, guestId: string) {
  const cfg = deps.config ?? loyaltyConfig;
  const now = clock(deps);
  const account = await deps.repo.getAccount(guestId);
  if (!account) throw new GuestNotFoundError();
  const [balance, rewards] = await Promise.all([deps.rewards.getBalance(guestId, now), deps.rewards.listActiveRewards()]);
  const available = balance?.available ?? 0;
  // Mesma regra do resgate na recepção (redemptions.ts): nível vencido não abre prêmio restrito.
  // Assim a página nunca diz "disponível" para um prêmio que a recepção recusaria.
  const rank = account.tierRank > 0 && (!account.tierValidUntil || account.tierValidUntil <= now) ? 0 : account.tierRank;
  return rewards.map((r) => {
    const tierOk = rank >= r.minTierRank;
    return {
      name: r.name,
      type: r.type,
      description: r.description ?? null,
      pointsCost: r.pointsCost,
      minTier: (cfg.tiers.find((t) => t.rank === r.minTierRank) ?? cfg.tiers[0]).name,
      canRedeem: tierOk && available >= r.pointsCost,
      missingPoints: Math.max(0, r.pointsCost - available),
      tierOk,
    };
  });
}
