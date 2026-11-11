import { PrismaClient } from '@prisma/client';
import { buildApp } from './api/app';
import { PrismaGuestRepository } from './infra/prisma/guestRepository';
import { PrismaRewardRepository } from './infra/prisma/rewardRepository';
import { PrismaStayRepository } from './infra/prisma/stayRepository';

// Exige tamanho mínimo e variedade de caracteres (rejeita "aaaa...", "1234...").
const strongSecret = (v: string | undefined, minLen: number): v is string =>
  !!v && v.length >= minLen && new Set(v).size >= 12;

const secret = process.env.DOCUMENT_HASH_SECRET;
if (!strongSecret(secret, 32)) {
  console.error('Defina DOCUMENT_HASH_SECRET no .env: mínimo 32 caracteres aleatórios e variados.');
  process.exit(1);
}
const internalApiKey = process.env.INTERNAL_API_KEY;
if (!strongSecret(internalApiKey, 24)) {
  console.error('Defina INTERNAL_API_KEY no .env: mínimo 24 caracteres aleatórios e variados.');
  process.exit(1);
}

const prisma = new PrismaClient();
const app = buildApp(
  {
    signup: { repo: new PrismaGuestRepository(prisma), documentSecret: secret },
    loyalty: { stays: new PrismaStayRepository(prisma) },
    rewards: { repo: new PrismaRewardRepository(prisma) },
    internalApiKey,
  },
  { logger: true },
);

const port = Number(process.env.PORT ?? 3000);

async function start() {
  // O cadastro precisa do nível inicial (rank 0); sem o seed, falharia com erro 500.
  if (!(await prisma.tier.findUnique({ where: { rank: 0 } }))) {
    console.error('Níveis não encontrados. Rode: npm run db:seed');
    process.exit(1);
  }
  await app.listen({ port, host: '0.0.0.0' });
}
start().catch((err) => {
  console.error(err);
  process.exit(1);
});
