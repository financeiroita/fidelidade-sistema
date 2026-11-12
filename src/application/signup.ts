import { randomInt, randomUUID } from 'node:crypto';
import { loyaltyConfig, type LoyaltyConfig } from '../config/loyalty';
import type { SignupInput } from '../domain/guests/signup';
import { documentLast4, hashDocument } from '../infra/security/document';
import { DuplicateGuestError, ReferralCodeCollisionError, type GuestRepository } from './ports';

export interface SignupDeps {
  repo: GuestRepository;
  documentSecret: string;
  config?: LoyaltyConfig;
  now?: () => Date;
}

export interface SignupResult {
  id: string;
  referralCode: string;
  tier: string;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function generateReferralCode(repo: GuestRepository, fullName: string): Promise<string> {
  const firstName = fullName.trim().split(/\s+/)[0];
  const prefix = firstName.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4) || 'HOSP';
  for (let attempt = 0; attempt < 10; attempt++) {
    let suffix = '';
    for (let i = 0; i < 4; i++) suffix += CODE_CHARS[randomInt(CODE_CHARS.length)];
    const code = `${prefix}-${suffix}`;
    if (!(await repo.findByReferralCode(code))) return code;
  }
  throw new Error('Não foi possível gerar um código de indicação único.');
}

/** Cadastra o hóspede no programa (nível inicial Bronze). Valores de entrada já validados. */
export async function signupGuest(deps: SignupDeps, input: SignupInput): Promise<SignupResult> {
  const cfg = deps.config ?? loyaltyConfig;
  const now = (deps.now ?? (() => new Date()))();
  const { repo } = deps;

  const documentHash = hashDocument(input.document, input.documentType, deps.documentSecret);
  if ((await repo.findByDocumentHash(documentHash)) || (await repo.findByEmail(input.email))) {
    throw new DuplicateGuestError('Já existe um cadastro com estes dados.');
  }

  // Código de indicação inválido não bloqueia o cadastro; apenas não gera bônus.
  const referrer = input.referralCode ? await repo.findByReferralCode(input.referralCode) : null;

  const id = randomUUID();
  // Não vira ponto no cadastro: só após o 1º check-out confirmado, para evitar contas falsas.
  const pendingWelcomePoints = referrer ? cfg.referral.refereeWelcomePoints : 0;

  const guestData = (referralCode: string) => ({
      id,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      documentType: input.documentType,
      documentHash,
      documentLast4: documentLast4(input.document, input.documentType),
      birthDate: new Date(`${input.birthDate}T00:00:00Z`),
      city: input.city,
      state: input.state,
      travelProfile: input.travelProfile,
      acquisitionSrc: input.acquisitionSrc,
      marketingConsent: input.marketingConsent,
      consentAt: now,
      memberSince: now,
      referralCode,
      referredById: referrer?.id,
      welcomeBonusPending: pendingWelcomePoints,
  });

  // Duas inscrições simultâneas podem sortear o mesmo código: tenta de novo com outro.
  for (let attempt = 0; ; attempt++) {
    const referralCode = await generateReferralCode(repo, input.fullName);
    try {
      await repo.create(guestData(referralCode));
      // Não devolve se o código de indicação valeu: isso revelaria quais códigos existem.
      return { id, referralCode, tier: cfg.tiers[0].name };
    } catch (e) {
      if (!(e instanceof ReferralCodeCollisionError) || attempt >= 4) throw e;
    }
  }
}
