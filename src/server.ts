import './env';
import { PrismaClient } from '@prisma/client';
import { buildApp } from './api/app';
import { PrismaAuditRepository, PrismaAuthRepository } from './infra/prisma/authRepository';
import type { GuestCodeSender } from './application/ports';
import { guestCodeDelivery, proxyAddrs, strongSecret, type Checked } from './config/startup';
import { PrismaGuestPortalRepository } from './infra/prisma/guestPortalRepository';
import { PrismaGuestRepository } from './infra/prisma/guestRepository';
import { PrismaRewardRepository } from './infra/prisma/rewardRepository';
import { PrismaStayRepository } from './infra/prisma/stayRepository';
import { warmUpPasswordHashing } from './infra/security/password';

/** Mostra o erro de configuração e encerra. */
function must<T>(r: Checked<T>): T {
  if (!r.ok) {
    console.error(r.error);
    process.exit(1);
  }
  return r.value;
}

const secret = process.env.DOCUMENT_HASH_SECRET;
if (!strongSecret(secret, 32)) {
  console.error('Defina DOCUMENT_HASH_SECRET no .env: mínimo 32 caracteres aleatórios e variados.');
  process.exit(1);
}

/**
 * Envio do código de acesso do hóspede. O provedor de e-mail ainda não foi escolhido pelo hotel
 * (pergunta em aberto); até lá só existe o modo de teste, que mostra o código no terminal.
 */
function guestCodeSender(): GuestCodeSender | undefined {
  if (must(guestCodeDelivery(process.env)) === 'off') return undefined; // login do hóspede responde 503
  return {
    // Sem o e-mail no terminal: só o código, para testar a tela.
    send: async (_to, code) => console.log(`[TESTE] código de acesso do hóspede: ${code}`),
  };
}

const prisma = new PrismaClient();
const stays = new PrismaStayRepository(prisma);
const rewards = new PrismaRewardRepository(prisma);
const app = buildApp(
  {
    signup: { repo: new PrismaGuestRepository(prisma), documentSecret: secret },
    loyalty: { stays },
    rewards: { repo: rewards },
    guestPortal: {
      repo: new PrismaGuestPortalRepository(prisma),
      rewards,
      stays,
      codeSecret: secret,
      sender: guestCodeSender(),
      onCodeFailure: (guestId) => console.warn(JSON.stringify({ at: new Date().toISOString(), event: 'codigo-hospede-errado', guestId })),
      onSendError:(errName) => console.error(JSON.stringify({ at: new Date().toISOString(), event: 'falha-envio-codigo', errName })),
    },
    auth: {
      repo: new PrismaAuthRepository(prisma),
      audit: new PrismaAuditRepository(prisma),
      // Só o código do erro, nunca dados pessoais.
      onAuditError: (code) => console.error(JSON.stringify({ at: new Date().toISOString(), event: 'falha-auditoria', code })),
    },
  },
  // TRUST_PROXY_ADDRS = endereços dos proxies/balanceadores SEUS (ex.: 127.0.0.1 se o Nginx está na mesma máquina).
  // Só pedidos vindos deles podem informar o IP do visitante; quem conecta direto não consegue inventar o IP.
  { logger: true, trustProxy: must(proxyAddrs(process.env)) },
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
