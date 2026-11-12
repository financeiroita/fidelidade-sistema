import '../src/env';
import { PrismaClient } from '@prisma/client';
import { loyaltyConfig } from '../src/config/loyalty';

const prisma = new PrismaClient();

async function main() {
  for (const t of loyaltyConfig.tiers) {
    await prisma.tier.upsert({
      where: { rank: t.rank },
      update: { name: t.name, minQualifyingPts: t.minQualifyingPts, multiplier: t.multiplier },
      create: { name: t.name, rank: t.rank, minQualifyingPts: t.minQualifyingPts, multiplier: t.multiplier },
    });
  }
  console.log('Níveis atualizados:', loyaltyConfig.tiers.map((t) => t.name).join(', '));
}

main().finally(() => prisma.$disconnect());
