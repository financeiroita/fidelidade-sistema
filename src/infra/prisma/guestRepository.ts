import { Prisma, type PrismaClient } from '@prisma/client';
import { DuplicateGuestError, type GuestRepository, type NewCredit, type NewGuest } from '../../application/ports';

export class PrismaGuestRepository implements GuestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByDocumentHash(hash: string) {
    return this.prisma.guest.findUnique({ where: { document: hash }, select: { id: true } });
  }
  findByEmail(email: string) {
    return this.prisma.guest.findUnique({ where: { email }, select: { id: true } });
  }
  findByReferralCode(code: string) {
    return this.prisma.guest.findUnique({ where: { referralCode: code }, select: { id: true } });
  }

  async create(g: NewGuest, welcome?: NewCredit): Promise<void> {
    try {
      await this.prisma.guest.create({
        data: {
          id: g.id,
          fullName: g.fullName,
          email: g.email,
          phone: g.phone,
          documentType: g.documentType,
          document: g.documentHash,
          documentLast4: g.documentLast4,
          birthDate: g.birthDate,
          city: g.city,
          state: g.state,
          travelProfile: g.travelProfile,
          acquisitionSrc: g.acquisitionSrc,
          marketingConsent: g.marketingConsent,
          consentAt: g.consentAt,
          referralCode: g.referralCode,
          tier: { connect: { rank: 0 } },
          referredBy: g.referredById ? { connect: { id: g.referredById } } : undefined,
          pointsTx: welcome
            ? {
                create: {
                  type: welcome.type,
                  points: welcome.points,
                  remaining: welcome.points,
                  qualifying: welcome.qualifying,
                  expiresAt: welcome.expiresAt,
                  idempotencyKey: welcome.idempotencyKey,
                  note: welcome.note,
                },
              }
            : undefined,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new DuplicateGuestError('Já existe um cadastro com estes dados.');
      }
      throw e;
    }
  }
}
