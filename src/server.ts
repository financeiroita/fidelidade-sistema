import { isIP } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { buildApp } from './api/app';
import { PrismaAuditRepository, PrismaAuthRepository } from './infra/prisma/authRepository';
import type { GuestCodeSender } from './application/ports';
import { PrismaGuestPortalRepository } from './infra/prisma/guestPortalRepository';
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

/** IP (v4/v6) com faixa opcional (/n); recusa "confiar em todos" (prefixo /0). */
function validProxyAddr(v: string): boolean {
  const [ip, prefix, extra] = v.split('/');
  const kind = isIP(ip);
  if (!kind || extra !== undefined) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const n = Number(prefix);
  return n >= 1 && n <= (kind === 4 ? 32 : 128);
}

function proxyAddrs(): string[] | false {
  for (const old of ['TRUST_PROXY', 'TRUST_PROXY_HOPS']) {
    if (process.env[old] !== undefined) {
      console.error(`${old} foi substituído por TRUST_PROXY_ADDRS (endereços dos seus proxies, ex.: 127.0.0.1). Ver README.`);
      process.exit(1);
    }
  }
  const v = process.env.TRUST_PROXY_ADDRS?.trim();
  if (!v) return false;
  const list = v.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((a) => !validProxyAddr(a));
  if (bad.length > 0) {
    console.error(`TRUST_PROXY_ADDRS inválido: ${bad.join(', ')}. Use IPs ou faixas (ex.: 127.0.0.1,10.0.0.0/8).`);
    process.exit(1);
  }
  return list;
}

/**
 * Envio do código de acesso do hóspede. O provedor de e-mail ainda não foi escolhido pelo hotel
 * (pergunta em aberto); até lá só existe o modo de teste, que mostra o código no terminal.
 */
function guestCodeSender(): GuestCodeSender | undefined {
  const mode = process.env.GUEST_CODE_DELIVERY;
  if (!mode) return undefined; // "Minha conta" fica sem login (503) até configurar
  if (mode === 'console') {
    if (process.env.NODE_ENV === 'production') {
      console.error('GUEST_CODE_DELIVERY=console é só para testes; não use em produção.');
      process.exit(1);
    }
    return {
      // Sem o e-mail no terminal: só o código, para testar a tela.
      send: async (_to, code) => console.log(`[TESTE] código de acesso do hóspede: ${code}`),
    };
  }
  console.error('GUEST_CODE_DELIVERY inválido. Valores aceitos hoje: console (só para testes).');
  process.exit(1);
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
      sender: guestCodeSender(),
      onSendError: (errName) => console.error(JSON.stringify({ at: new Date().toISOString(), event: 'falha-envio-codigo', errName })),
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
  { logger: true, trustProxy: proxyAddrs() },
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
