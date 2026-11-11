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
}

export interface NewCredit {
  type: 'EARN_BONUS';
  points: number;
  qualifying: false;
  expiresAt: Date;
  idempotencyKey: string;
  note: string;
}

export class DuplicateGuestError extends Error {}
/** Conflito apenas no código de indicação; o cadastro pode tentar de novo com outro código. */
export class ReferralCodeCollisionError extends Error {}

export interface GuestRepository {
  findByDocumentHash(hash: string): Promise<{ id: string } | null>;
  findByEmail(email: string): Promise<{ id: string } | null>;
  findByReferralCode(code: string): Promise<{ id: string } | null>;
  /** Cria o hóspede (nível inicial) e o crédito de boas-vindas, se houver, de forma atômica. */
  create(guest: NewGuest, welcomeCredit?: NewCredit): Promise<void>;
}
