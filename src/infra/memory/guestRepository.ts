import { DuplicateGuestError, ReferralCodeCollisionError, type GuestRepository, type NewGuest } from '../../application/ports';

/** Implementação em memória, usada nos testes. */
export class InMemoryGuestRepository implements GuestRepository {
  guests: NewGuest[] = [];

  async findByDocumentHash(hash: string) {
    return this.guests.find((g) => g.documentHash === hash) ?? null;
  }
  async findByEmail(email: string) {
    return this.guests.find((g) => g.email === email) ?? null;
  }
  async findByReferralCode(code: string) {
    return this.guests.find((g) => g.referralCode === code) ?? null;
  }
  async create(guest: NewGuest) {
    if (this.guests.some((g) => g.documentHash === guest.documentHash || g.email === guest.email)) {
      throw new DuplicateGuestError('duplicado');
    }
    if (this.guests.some((g) => g.referralCode === guest.referralCode)) throw new ReferralCodeCollisionError();
    this.guests.push(guest);
  }
}
