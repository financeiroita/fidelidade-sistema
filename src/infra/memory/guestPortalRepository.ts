import { sameHash } from '../../application/guestPortal';
import type { GuestAccount, GuestPortalRepository } from '../../application/ports';
import type { InMemoryGuestRepository } from './guestRepository';
import type { InMemoryStayRepository } from './stayRepository';

interface StoredCode {
  id: string;
  guestId: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

/** Implementação em memória, usada nos testes. Mesmas regras do banco. */
export class InMemoryGuestPortalRepository implements GuestPortalRepository {
  codes: StoredCode[] = [];
  sessions = new Map<string, { guestId: string; expiresAt: Date }>();

  constructor(
    private readonly guests: InMemoryGuestRepository,
    private readonly stays: InMemoryStayRepository,
  ) {}

  async findActiveGuestByEmail(email: string) {
    const g = this.guests.guests.find((x) => x.email === email && !x.deletedAt);
    return g ? { id: g.id, email: g.email, fullName: g.fullName } : null;
  }

  async issueLoginCode(
    c: { id: string; guestId: string; codeHash: string; expiresAt: Date; now: Date },
    limit: { since: Date; max: number },
  ) {
    if (!this.guests.active(c.guestId)) return false;
    const recent = this.codes.filter((x) => x.guestId === c.guestId && x.createdAt >= limit.since).length;
    if (recent >= limit.max) return false;
    for (const x of this.codes) if (x.guestId === c.guestId && !x.usedAt) x.usedAt = c.now;
    this.codes.push({ id: c.id, guestId: c.guestId, codeHash: c.codeHash, attempts: 0, expiresAt: c.expiresAt, usedAt: null, createdAt: c.now });
    return true;
  }

  async verifyLoginCode(guestId: string, codeHash: string, now: Date, maxAttempts: number) {
    const code = this.codes
      .filter((x) => x.guestId === guestId && !x.usedAt && x.expiresAt > now)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!code) return false;
    if (sameHash(code.codeHash, codeHash)) {
      code.usedAt = now;
      return true;
    }
    code.attempts++;
    if (code.attempts >= maxAttempts) code.usedAt = now;
    return false;
  }

  async createGuestSession(s: { tokenHash: string; guestId: string; expiresAt: Date }) {
    this.sessions.set(s.tokenHash, { guestId: s.guestId, expiresAt: s.expiresAt });
  }

  async findGuestSession(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    return s && this.guests.active(s.guestId) ? s : null;
  }

  async deleteGuestSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }

  async getAccount(guestId: string): Promise<GuestAccount | null> {
    const g = this.guests.active(guestId);
    if (!g) return null;
    const t = this.stays.tiers.get(guestId);
    return {
      id: g.id,
      fullName: g.fullName,
      tierRank: t?.rank ?? 0,
      tierValidUntil: t?.validUntil ?? null,
      referralCode: g.referralCode,
      memberSince: g.memberSince,
    };
  }

  async upcomingExpirations(guestId: string, now: Date, limit: number) {
    const byDate = new Map<number, number>();
    for (const t of this.stays.transactions) {
      if (t.guestId === guestId && t.remaining > 0 && t.expiresAt && t.expiresAt > now) {
        byDate.set(t.expiresAt.getTime(), (byDate.get(t.expiresAt.getTime()) ?? 0) + t.remaining);
      }
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, limit)
      .map(([ms, points]) => ({ expiresAt: new Date(ms), points }));
  }
}
