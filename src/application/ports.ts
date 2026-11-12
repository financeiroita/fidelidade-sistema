import type { DocumentType } from '../infra/security/document';

export interface NewGuest {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  documentType: DocumentType;
  documentHash: string;
  documentLast4: string;
  birthDate: Date;
  city?: string;
  state?: string;
  travelProfile?: string;
  acquisitionSrc?: string;
  marketingConsent: boolean;
  consentAt: Date;
  /** Data de entrada no programa (relógio da aplicação). Estadias anteriores a ela não pontuam. */
  memberSince: Date;
  referralCode: string;
  referredById?: string;
  /** Boas-vindas por indicação aguardando o 1º check-out (0 = nenhum). */
  welcomeBonusPending: number;
}

export class DuplicateGuestError extends Error {}
/** Conflito apenas no código de indicação; o cadastro pode tentar de novo com outro código. */
export class ReferralCodeCollisionError extends Error {}

// ---- Estadias e crédito de pontos ----
import type { ChargeInput } from '../domain/points/earn';

export type StayStatus = 'RESERVED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';
export type EarnTxType = 'EARN_STAY' | 'EARN_CHARGE' | 'EARN_BONUS';

export interface NewPointsTx {
  guestId: string;
  type: EarnTxType;
  points: number;
  /** Parte dos pontos que conta para o nível (valor base, sem multiplicador). */
  qualifyingPts: number;
  expiresAt: Date;
  stayId?: string;
  idempotencyKey: string;
  note?: string;
}

export interface NewStay {
  id: string;
  guestId: string;
  channel: string;
  isDirect: boolean;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  roomType?: string;
  adults: number;
  children: number;
  /** Identificador único do lançamento manual (evita duplicar). */
  externalRef?: string;
  charges: Array<ChargeInput & { description?: string }>;
}

/**
 * Regra checada pelo repositório com o hóspede travado: recebe a data de cadastro do hóspede e
 * diz se a estadia pode ser lançada (estadia inteiramente anterior ao cadastro não pontua).
 */
export type MemberSinceRule = (memberSince: Date) => boolean;

export interface CheckoutData {
  stay: {
    id: string;
    guestId: string;
    status: StayStatus;
    isDirect: boolean;
    checkOut: Date;
    pointsProcessedAt: Date | null;
  };
  charges: ChargeInput[];
  guest: {
    id: string;
    tierRank: number;
    /** Validade do nível. Nível vencido (rotina noturna ainda não rodou) não dá multiplicador. */
    tierValidUntil: Date | null;
    referredById: string | null;
    welcomeBonusPending: number;
    /** Falso se o hóspede foi anonimizado (LGPD): não ganha mais pontos. */
    active: boolean;
    /** Falso se quem indicou foi anonimizado: não recebe o bônus de indicação. */
    referrerActive: boolean;
  };
  /** O hóspede já ganhou pontos por alguma estadia/consumo antes? (estadia sem receita não conta) */
  hasPriorEarning: boolean;
}

export interface CheckoutCommit {
  stayId: string;
  guestId: string;
  transactions: NewPointsTx[];
  /** Início da janela do nível (12 meses): os pontos-base são somados de novo sob a trava. */
  tierWindowStart: Date;
  /**
   * Decide o nível com os pontos-base lidos sob a trava (já incluindo os desta estadia), para dois
   * check-outs simultâneos do mesmo hóspede não perderem a subida de nível.
   */
  decideTier: (qualifyingPts: number, currentRank: number) => { newTierRank?: number; tierValidUntil?: Date };
  clearWelcomePending: boolean;
  /** Relógio da aplicação: também é a data gravada nos lançamentos (createdAt). */
  processedAt: Date;
}

export class GuestNotFoundError extends Error {}
/** Estadia já lançada (mesmo identificador, ou sem identificador e com período sobreposto). */
export class DuplicateStayError extends Error {}
/** Estadia inteiramente anterior ao cadastro do hóspede, ou antiga demais para lançamento manual. */
export class StayOutOfPeriodError extends Error {}
export class StayNotFoundError extends Error {}
export class StayNotEligibleError extends Error {}
/** Outro processamento do mesmo check-out chegou primeiro. */
export class StayAlreadyProcessedError extends Error {}

export interface StayRepository {
  /**
   * Trava o hóspede e grava a estadia. Recusa (StayOutOfPeriodError) se `allowed(memberSince)` for
   * falso, e (DuplicateStayError) se o identificador já existe ou, sem identificador, se o período
   * se sobrepõe a outra estadia do hóspede.
   */
  createStay(stay: NewStay, allowed: MemberSinceRule): Promise<void>;
  loadCheckout(stayId: string): Promise<CheckoutData | null>;
  /** Soma de pontos qualificáveis do hóspede creditados desde a data (janela do nível). */
  qualifyingPointsSince(guestId: string, since: Date): Promise<number>;
  /** Atômico: grava créditos, marca a estadia como processada, atualiza nível e zera o pendente. Devolve o nível final e sua validade. */
  commitCheckout(commit: CheckoutCommit): Promise<{ tierRank: number; tierValidUntil: Date | null }>;
}

// ---- Resgates ----
import type { Consumption, Lot } from '../domain/points/expiry';

export type RewardType = 'FREE_NIGHT' | 'UPGRADE' | 'DINING' | 'SPA' | 'DISCOUNT' | 'EXPERIENCE';
export type RedemptionStatus = 'PENDING' | 'CONFIRMED' | 'USED' | 'CANCELLED';

export interface NewReward {
  name: string;
  type: RewardType;
  pointsCost: number;
  description?: string;
  minTierRank: number;
}
export interface RewardRow extends NewReward {
  id: string;
  active: boolean;
}
export interface NewRedemption {
  id: string;
  guestId: string;
  rewardId: string;
  points: number;
  code: string;
  requestId: string;
  /** De quais lotes os pontos saíram (para devolver no cancelamento). */
  lots: Consumption[];
}
export interface RedemptionRow extends NewRedemption {
  status: RedemptionStatus;
  stayId: string | null;
}
export interface RewardGuest {
  id: string;
  tierRank: number;
  tierValidUntil: Date | null;
  active: boolean;
}
export interface StatementRow {
  at: Date;
  type: string;
  points: number;
  note: string | null;
}

export class RewardNotAvailableError extends Error {}
export class TierTooLowError extends Error {}
export class InsufficientPointsError extends Error {
  constructor(public readonly available: number) {
    super('Saldo insuficiente');
  }
}
export class RedemptionNotFoundError extends Error {}
/** A estadia informada não existe ou não é do hóspede. */
export class InvalidStayError extends Error {}
export class InvalidTransitionError extends Error {}
/** O mesmo requestId já foi usado por outro hóspede ou prêmio. */
export class RequestIdReusedError extends Error {}

/** Operações dentro da transação do hóspede (hóspede travado: um fluxo por vez). */
export interface RewardUow {
  getGuest(guestId: string): Promise<RewardGuest | null>;
  getReward(rewardId: string): Promise<RewardRow | null>;
  getRedemptionByRequest(requestId: string): Promise<RedemptionRow | null>;
  getRedemption(id: string): Promise<RedemptionRow | null>;
  /** Lotes com saldo e ainda dentro da validade. */
  loadUsableLots(guestId: string, now: Date): Promise<Lot[]>;
  /** Grava o resgate (PENDING), abate os lotes e lança o débito REDEEM no extrato. */
  createRedemption(r: NewRedemption, rewardName: string, now: Date): Promise<void>;
  setStatus(id: string, status: RedemptionStatus, extra?: { stayId?: string; usedAt?: Date }): Promise<void>;
  /**
   * Cancela e devolve os pontos: lote ainda válido recebe o saldo de volta; lote já vencido não
   * (a parte dele é lançada como vencida na hora, sem dar prazo extra). Lança REVERSAL e marca CANCELLED.
   */
  cancelRedemption(r: RedemptionRow, now: Date): Promise<void>;
  /** A estadia existe e é deste hóspede? */
  stayBelongsToGuest(stayId: string, guestId: string): Promise<boolean>;
}

export type RewardPatch = Partial<Omit<NewReward, 'type'>> & { active?: boolean };

export interface RewardRepository {
  createReward(r: NewReward): Promise<RewardRow>;
  /** Corrige ou desativa um prêmio. Resgates já feitos não mudam. Devolve null se não existir. */
  updateReward(id: string, patch: RewardPatch): Promise<RewardRow | null>;
  listActiveRewards(): Promise<RewardRow[]>;
  findRedemptionGuest(redemptionId: string): Promise<string | null>;
  /** Trava o hóspede e executa tudo numa transação. Se `fn` lançar erro, nada é gravado. */
  inGuestTransaction<T>(guestId: string, fn: (uow: RewardUow) => Promise<T>): Promise<T>;
  getBalance(
    guestId: string,
    now: Date,
  ): Promise<{ available: number; ledger: number; pendingWelcome: number } | null>;
  getStatement(guestId: string, limit: number): Promise<StatementRow[]>;
}

// ---- Rotina noturna (vencimento de pontos, nível, avisos) ----
import type { ExpirationPlan, LotRow, NoticePlan } from '../domain/points/maintenance';

export interface MaintenanceRepository {
  /** Apaga sessões de login vencidas. Devolve quantas. */
  purgeExpiredSessions(now: Date): Promise<number>;
  /** Lotes com saldo que vencem até `until` (hoje + maior janela de aviso). */
  loadActiveLots(until: Date): Promise<LotRow[]>;
  /** Zera o lote e grava o lançamento EXPIRE (com data `now`). Devolve false se o lote mudou/já foi tratado. */
  expireLot(item: ExpirationPlan, now: Date): Promise<boolean>;
  /** Hóspedes ativos acima do nível inicial cuja validade do nível acabou (ou nunca foi definida). */
  findTierReviewCandidates(now: Date): Promise<Array<{ guestId: string }>>;
  /**
   * Revisa o nível de um hóspede. Trava o hóspede, soma os pontos-base desde `since` já sob a
   * trava (sem leitura velha) e aplica a decisão. Devolve null se não há o que revisar
   * (validade renovada por um check-out no meio, hóspede anonimizado ou já no nível inicial).
   */
  reviewTier(
    guestId: string,
    now: Date,
    since: Date,
    decide: (qualifyingPts: number) => { newRank: number; validUntil: Date | null },
  ): Promise<{ previousRank: number; newRank: number } | null>;
  /** Grava avisos novos (ignora os já existentes). Devolve quantos foram criados. */
  saveNotices(notices: NoticePlan[]): Promise<number>;
}

export interface GuestRepository {
  findByDocumentHash(hash: string): Promise<{ id: string } | null>;
  findByEmail(email: string): Promise<{ id: string } | null>;
  findByReferralCode(code: string): Promise<{ id: string } | null>;
  /** Cria o hóspede com o nível inicial. */
  create(guest: NewGuest): Promise<void>;
}

// ---- Login de funcionários e registro de quem fez o quê ----
import type { Role } from '../domain/auth/auth';

export interface OperatorRow {
  id: string;
  username: string;
  name: string;
  role: Role;
  passwordHash: string;
  active: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
}

export class InvalidCredentialsError extends Error {}
export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}
export class DuplicateOperatorError extends Error {}
export class OperatorNotFoundError extends Error {}
export class WeakPasswordError extends Error {}
export class CannotDeactivateSelfError extends Error {}
/** Desativar este administrador deixaria o sistema sem nenhum administrador ativo. */
export class LastAdminError extends Error {}
/** Para trocar a própria senha use a rota própria (que exige a senha atual). */
export class CannotResetOwnPasswordError extends Error {}

export interface AuthRepository {
  findOperatorByUsername(username: string): Promise<OperatorRow | null>;
  findOperatorById(id: string): Promise<OperatorRow | null>;
  createOperator(op: OperatorRow): Promise<void>;
  listOperators(): Promise<Array<Omit<OperatorRow, 'passwordHash' | 'failedAttempts'>>>;
  /** Conta uma falha; ao chegar em `max`, trava até `lockUntil` e zera o contador. Atômico. */
  recordLoginFailure(id: string, max: number, lockUntil: Date): Promise<void>;
  recordLoginSuccess(id: string): Promise<void>;
  setPassword(id: string, passwordHash: string): Promise<void>;
  setActive(id: string, active: boolean): Promise<void>;
  /**
   * Desativa com proteção: nunca deixa o sistema sem administrador ativo, nem com dois pedidos
   * simultâneos (um desativando o outro). Atômico.
   */
  deactivateOperatorGuarded(id: string): Promise<'ok' | 'last_admin' | 'not_found'>;
  createSession(s: { tokenHash: string; operatorId: string; expiresAt: Date }): Promise<void>;
  findSession(tokenHash: string): Promise<{ operatorId: string; expiresAt: Date } | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Encerra as sessões do funcionário (todas, ou todas menos a informada). */
  deleteSessionsOf(operatorId: string, exceptTokenHash?: string): Promise<void>;
}

/** Só valores simples (ids, contagens, pontos). Nunca dados pessoais do hóspede. */
export type AuditDetails = Record<string, string | number | boolean | null>;
export interface AuditEntry {
  at: Date;
  operatorId: string | null;
  operatorName: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  ok: boolean;
  details?: AuditDetails;
}
export interface AuditRepository {
  record(entry: AuditEntry): Promise<void>;
  list(filter: { entity?: string; entityId?: string; operatorId?: string; limit: number }): Promise<AuditEntry[]>;
}
