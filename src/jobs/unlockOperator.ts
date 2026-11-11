// Recuperação: reativa um funcionário, tira o bloqueio por senhas erradas e encerra as sessões dele.
// Use se a conta do administrador for desativada ou travada e ninguém mais conseguir entrar:
//   npm run operator:unlock -- --username maria
// Para trocar a senha depois, entre com outro administrador ou crie um novo administrador.
import { PrismaClient } from '@prisma/client';
import { usernameSchema } from '../domain/auth/auth';

async function main() {
  const i = process.argv.indexOf('--username');
  const username = usernameSchema.safeParse(i >= 0 ? process.argv[i + 1] : undefined);
  if (!username.success) {
    console.error('Uso: npm run operator:unlock -- --username maria');
    process.exitCode = 1;
    return;
  }
  const prisma = new PrismaClient();
  try {
    const op = await prisma.operator.findUnique({ where: { username: username.data }, select: { id: true } });
    if (!op) {
      console.error('Usuário não encontrado.');
      process.exitCode = 1;
      return;
    }
    await prisma.$transaction([
      prisma.operator.update({ where: { id: op.id }, data: { active: true, failedAttempts: 0, lockedUntil: null } }),
      prisma.session.deleteMany({ where: { operatorId: op.id } }),
      prisma.auditLog.create({
        data: { operatorName: 'linha de comando', action: 'operator.unlock', entity: 'operator', entityId: op.id },
      }),
    ]);
    console.log(`Conta liberada: ${username.data}.`);
  } catch (e) {
    const x = e as { code?: string; name?: string };
    console.error('Falha:', `erro ${x?.code ?? x?.name ?? 'desconhecido'}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
