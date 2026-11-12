import { PrismaClient } from '@prisma/client';
import { buildApp } from './api/app';
import { PrismaAuditRepository, PrismaAuthRepository } from './infra/prisma/authRepository';
import { PrismaGuestRepository } from './infra/prisma/guestRepository';
import { PrismaRewardRepository } from './infra/prisma/rewardRepository';
import { PrismaStayRepository } from './infra/prisma/stayRepository';
import { warmUpPasswordHashing } from './infra/security/password';

// Exige tamanho mínimo e variedade de caracteres (rejeita "aaaa...", "1234...").
const strongSecret = (v: string | undefined, minLen: number): v is string =>
  !!v && v.length >= minLen && new Set(v).size >= 12;

const secret = process.env.DOCUMENT_HASH_SECRET;
if (!strongSecret(secret, 32)) {
  console.error('Defina DOCUMENT_HASH_SECRET no .env: mínimo 32 caracteres aleatórios e variados.');
  process.exit(1);
}

function proxyHops(): number | false {
  if (process.env.TRUST_PROXY !== undefined) {
    console.error('TRUST_PROXY foi substituído por TRUST_PROXY_HOPS (número de proxies na frente). Ver README.');
    process.exit(1);
  }
  const v = process.env.TRUST_PROXY_HOPS;
  if (v === undefined || v === '' || v === '0') return false;
  if (!/^[1-9]$/.test(v)) {
    console.error('TRUST_PROXY_HOPS deve ser um número de 1 a 9.');
    process.exit(1);
  }
  return Number(v);
}

const prisma = new PrismaClient();
const app = buildApp(
  {
    signup: { repo: new PrismaGuestRepository(prisma), documentSecret: secret },
    loyalty: { stays: new PrismaStayRepository(prisma) },
    rewards: { repo: new PrismaRewardRepository(prisma) },
    auth: {
      repo: new PrismaAuthRepository(prisma),
      audit: new PrismaAuditRepository(prisma),
      // Só o código do erro, nunca dados pessoais.
      onAuditError: (code) => console.error(JSON.stringify({ at: new Date().toISOString(), event: 'falha-auditoria', code })),
    },
  },
  // TRUST_PROXY_HOPS = quantos proxies/balanceadores SEUS ficam na frente do servidor (ex.: 1).
  // Nunca "confiar em todos": o cliente poderia inventar o próprio IP no X-Forwarded-For e furar o limite.
  { logger: true, trustProxy: proxyHops() },
);

const port = Number(process.env.PORT ?? 3000);

async function start() {
  await warmUpPasswordHashing(); // o 1º login de usuário inexistente não demora o dobro
  // O cadastro precisa do nível inicial (rank 0); sem o seed, falharia com erro 500.
  if (!(await prisma.tier.findUnique({ where: { rank: 0 } }))) {
    console.error('Níveis não encontrados. Rode: npm run db:seed');
    process.exit(1);
  }
  // Sem nenhum administrador ninguém consegue entrar: avisa como criar o primeiro.
  if ((await prisma.operator.count({ where: { role: 'ADMIN', active: true } })) === 0) {
    console.error('Nenhum administrador ativo. Rode: npm run operator:create -- --username SEU_USUARIO --name "Seu Nome" --role ADMIN');
    process.exit(1);
  }
  await app.listen({ port, host: '0.0.0.0' });
}
start().catch((err) => {
  console.error(err);
  process.exit(1);
});
