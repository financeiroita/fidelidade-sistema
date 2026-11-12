// Rotina diária: vence pontos, revisa níveis e gera avisos de vencimento.
// Agende para rodar uma vez por dia, de madrugada (cron no Linux ou Agendador de Tarefas no Windows):
//   npm run job:nightly
// Códigos de saída: 0 = ok, 2 = terminou com erros em alguns itens, 1 = falha geral.
import '../env';
import { PrismaClient } from '@prisma/client';
import { runNightly } from '../application/maintenance';
import { PrismaMaintenanceRepository } from '../infra/prisma/maintenanceRepository';

const prisma = new PrismaClient();

async function main() {
  try {
    const result = await runNightly({
      repo: new PrismaMaintenanceRepository(prisma),
      // Só etapa, id (UUID) e código do erro: nunca dados pessoais nem mensagens do banco.
      logger: (event) => console.error(JSON.stringify({ at: new Date().toISOString(), ...event })),
    });
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
    if (result.errors > 0) process.exitCode = 2;
  } catch (err) {
    const e = err as { name?: string; code?: string };
    console.error('Falha na rotina noturna:', e?.code ?? e?.name ?? 'erro');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
