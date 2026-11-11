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
  };
  /** O hóspede já ganhou pontos por alguma estadia/consumo antes? (estadia sem receita não conta) */
  hasPriorEarning: boolean;
}

export interface CheckoutCommit {
  stayId: string;
  guestId: string;
  transactions: NewPointsTx[];
  newTierRank?: number;
  tierValidUntil?: Date;
  clearWelcomePending: boolean;
  processedAt: Date;
}

export class GuestNotFoundError extends Error {}
/** Estadia já lançada (mesmo identificador ou mesmo hóspede e datas). */
export class DuplicateStayError extends Error {}
export class StayNotFoundError extends Error {}
export class StayNotEligibleError extends Error {}
/** Outro processamento do mesmo check-out chegou primeiro. */
export class StayAlreadyProcessedError extends Error {}

export interface StayRepository {
  createStay(stay: NewStay): Promise<void>;
  loadCheckout(stayId: string): Promise<CheckoutData | null>;
  /** Soma de pontos qualificáveis do hóspede creditados desde a data (janela do nível). */
  qualifyingPointsSince(guestId: string, since: Date): Promise<number>;
  /** Atômico: grava créditos, marca a estadia como processada, atualiza nível e zera o pendente. */
  commitCheckout(commit: CheckoutCommit): Promise<void>;
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
  createRedemption(r: NewRedemption, rewardName: string): Promise<void>;
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
  /** Todos os lotes de pontos com saldo. */
  loadActiveLots(): Promise<LotRow[]>;
  /** Zera o lote e grava o lançamento EXPIRE. Devolve false se o lote mudou/já foi tratado. */
  expireLot(item: ExpirationPlan): Promise<boolean>;
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
