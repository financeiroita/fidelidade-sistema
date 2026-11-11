import { DuplicateGuestError, type GuestRepository, type NewCredit, type NewGuest } from '../../application/ports';

/** Implementação em memória, usada nos testes. */
export class InMemoryGuestRepository implements GuestRepository {
  guests: NewGuest[] = [];
  credits: Array<NewCredit & { guestId: string }> = [];

  async findByDocumentHash(hash: string) {
    return this.guests.find((g) => g.documentHash === hash) ?? null;
  }
  async findByEmail(email: string) {
    return this.guests.find((g) => g.email === email) ?? null;
  }
  async findByReferralCode(code: string) {
    return this.guests.find((g) => g.referralCode === code) ?? null;
  }
  async create(guest: NewGuest, welcomeCredit?: NewCredit) {
    if (this.guests.some((g) => g.documentHash === guest.documentHash || g.email === guest.email)) {
      throw new DuplicateGuestError('duplicado');
    }
    this.guests.push(guest);
    if (welcomeCredit) this.credits.push({ ...welcomeCredit, guestId: guest.id });
  }
}
