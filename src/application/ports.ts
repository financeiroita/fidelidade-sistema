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
  guest: { id: string; tierRank: number; referredById: string | null; welcomeBonusPending: number };
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

// ---- Rotina noturna (vencimento de pontos, nível, avisos) ----
import type { ExpirationPlan, LotRow, NoticePlan } from '../domain/points/maintenance';

export interface MaintenanceRepository {
  /** Todos os lotes de pontos com saldo. */
  loadActiveLots(): Promise<LotRow[]>;
  /** Zera o lote e grava o lançamento EXPIRE. Devolve false se o lote mudou/já foi tratado. */
  expireLot(item: ExpirationPlan): Promise<boolean>;
  /** Hóspedes acima do nível inicial cuja validade do nível acabou (ou nunca foi definida). */
  findTierReviewCandidates(now: Date): Promise<Array<{ guestId: string; tierRank: number }>>;
  qualifyingPointsSince(guestId: string, since: Date): Promise<number>;
  /** Aplica a revisão. Devolve false se o nível foi renovado por outro processo no meio. */
  applyTierReview(guestId: string, newRank: number, validUntil: Date | null, now: Date): Promise<boolean>;
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
