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
    limits: Array<{ since: Date; max: number }>,
  ) {
    if (!this.guests.active(c.guestId)) return false;
    for (const l of limits) {
      if (this.codes.filter((x) => x.guestId === c.guestId && x.createdAt >= l.since).length >= l.max) return false;
    }
    this.codes.push({ id: c.id, guestId: c.guestId, codeHash: c.codeHash, attempts: 0, expiresAt: c.expiresAt, usedAt: null, createdAt: c.now });
    return true;
  }

  async verifyLoginCode(
    guestId: string,
    codeHash: string,
    now: Date,
    policy: { maxAttemptsPerCode: number; maxFailures: number; failuresSince: Date },
  ) {
    const rows = this.codes
      .filter((x) => x.guestId === guestId && x.createdAt >= policy.failuresSince)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (rows.reduce((s, r) => s + r.attempts, 0) >= policy.maxFailures) return false;
    const valid = rows.filter((x) => !x.usedAt && x.expiresAt > now);
    if (valid.length === 0) return false;
    if (valid.map((r) => sameHash(r.codeHash, codeHash)).includes(true)) {
      for (const r of valid) r.usedAt = now;
      return true;
    }
    const newest = valid[0];
    newest.attempts++;
    if (newest.attempts >= policy.maxAttemptsPerCode) newest.usedAt = now;
    return false;
  }

  /** Igual à rotina noturna do banco: sessões vencidas e códigos vencidos há mais de 1 dia. */
  purge(now: Date): number {
    let n = 0;
    for (const [hash, s] of this.sessions) {
      if (s.expiresAt <= now) {
        this.sessions.delete(hash);
        n++;
      }
    }
    this.codes = this.codes.filter((c) => c.expiresAt.getTime() > now.getTime() - 86_400_000);
    return n;
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
