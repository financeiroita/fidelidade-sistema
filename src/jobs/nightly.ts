// Rotina diária: vence pontos, revisa níveis e gera avisos de vencimento.
// Agende para rodar uma vez por dia, de madrugada (cron no Linux ou Agendador de Tarefas no Windows):
//   npm run job:nightly
import { PrismaClient } from '@prisma/client';
import { runNightly } from '../application/maintenance';
import { PrismaMaintenanceRepository } from '../infra/prisma/maintenanceRepository';

const prisma = new PrismaClient();

runNightly({ repo: new PrismaMaintenanceRepository(prisma) })
  .then((result) => {
    console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
    if (result.errors > 0) process.exitCode = 2;
  })
  .catch((err) => {
    console.error('Falha na rotina noturna:', err?.name ?? 'erro');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
