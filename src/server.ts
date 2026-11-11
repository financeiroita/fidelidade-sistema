import { PrismaClient } from '@prisma/client';
import { buildApp } from './api/app';
import { PrismaGuestRepository } from './infra/prisma/guestRepository';

const secret = process.env.DOCUMENT_HASH_SECRET;
if (!secret || secret.length < 32) {
  console.error('Defina DOCUMENT_HASH_SECRET (mínimo 32 caracteres) no .env');
  process.exit(1);
}

const prisma = new PrismaClient();
const app = buildApp({ repo: new PrismaGuestRepository(prisma), documentSecret: secret }, { logger: true });

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
