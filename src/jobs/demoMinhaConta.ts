// Demonstração da "Minha conta" sem banco de dados: tudo em memória, com uma hóspede de exemplo.
// Uso: npm run demo:minha-conta  → abra http://localhost:3100/minha-conta e entre com demo@exemplo.com.
// O código de acesso aparece neste terminal. Nada é gravado; ao fechar, tudo some.
import { buildApp } from '../api/app';
import { InMemoryAuditRepository, InMemoryAuthRepository } from '../infra/memory/authRepository';
import { InMemoryGuestPortalRepository } from '../infra/memory/guestPortalRepository';
import { InMemoryGuestRepository } from '../infra/memory/guestRepository';
import { InMemoryRewardRepository } from '../infra/memory/rewardRepository';
import { InMemoryStayRepository } from '../infra/memory/stayRepository';
import { newSessionToken } from '../infra/security/token';

const SECRET = 'demonstracao-local-sem-dados-reais-0123456789';
const port = Number(process.env.PORT ?? 3100);

async function main() {
  const guests = new InMemoryGuestRepository();
  const stays = new InMemoryStayRepository(guests);
  const rewards = new InMemoryRewardRepository(stays, guests);
  const authRepo = new InMemoryAuthRepository();
  const app = buildApp(
    {
      signup: { repo: guests, documentSecret: SECRET },
      loyalty: { stays },
      rewards: { repo: rewards },
      auth: { repo: authRepo, audit: new InMemoryAuditRepository() },
      guestPortal: {
        repo: new InMemoryGuestPortalRepository(guests, stays),
        rewards,
        stays,
        sender: { send: async (_to, code) => console.log(`\n>>> Código de acesso: ${code}\n`) },
      },
    },
    { logger: false },
  );

  // Funcionário de demonstração (só na memória) para lançar as estadias de exemplo.
  const opId = '00000000-0000-4000-8000-000000000001';
  authRepo.operators.set(opId, {
    id: opId, username: 'demo', name: 'Demo', role: 'MANAGER', passwordHash: '-', active: true, failedAttempts: 0, lockedUntil: null,
  });
  const { token, hash } = newSessionToken();
  authRepo.sessions.set(hash, { operatorId: opId, expiresAt: new Date(Date.now() + 3_600_000) });
  const headers = { authorization: `Bearer ${token}` };
  const call = async (url: string, payload: object) => {
    const r = await app.inject({ method: 'POST', url, payload, headers });
    if (r.statusCode >= 300) throw new Error(`${url}: ${r.statusCode} ${r.body}`);
    return r.json();
  };

  // Hóspede de exemplo (CPF de teste, válido só no formato).
  const g = await call('/guests', {
    fullName: 'Marina Demonstração',
    email: 'demo@exemplo.com',
    phone: '12999990000',
    documentType: 'CPF',
    document: '529.982.247-25',
    birthDate: '1988-04-10',
    acceptedTerms: true,
  });
  // Cadastro "antigo" para aceitar estadias passadas.
  guests.guests[0].memberSince = new Date(Date.now() - 60 * 86_400_000);

  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const stay = async (inDays: number, outDays: number, channel: string, charges: object[], ref: string) => {
    const s = await call('/stays', { guestId: g.id, channel, checkIn: day(inDays), checkOut: day(outDays), externalRef: ref, charges });
    await call(`/stays/${s.id}/checkout`, {});
  };
  await stay(25, 22, 'DIRECT_WEBSITE', [{ category: 'ROOM', amount: 2400 }, { category: 'FNB', amount: 380 }], 'DEMO-1');
  await stay(6, 3, 'OTA', [{ category: 'ROOM', amount: 1900 }, { category: 'SPA', amount: 450 }], 'DEMO-2');

  for (const r of [
    { name: 'Café da manhã especial para dois', type: 'DINING', pointsCost: 1200, description: 'No restaurante do hotel.' },
    { name: 'Massagem relaxante (50 min)', type: 'SPA', pointsCost: 3500 },
    { name: 'Diária grátis', type: 'FREE_NIGHT', pointsCost: 9000, description: 'Quarto standard, sujeito a disponibilidade.' },
    { name: 'Upgrade para suíte', type: 'UPGRADE', pointsCost: 2500, minTierRank: 2 },
  ]) await call('/rewards', r);

  await app.listen({ port, host: '127.0.0.1' });
  console.log(`Demonstração em http://localhost:${port}/minha-conta  (e-mail: demo@exemplo.com)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
