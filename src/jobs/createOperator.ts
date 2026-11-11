// Cria um funcionário com login (o primeiro deve ser ADMIN). A senha é pedida no terminal,
// sem aparecer na tela nem ficar no histórico de comandos:
//   npm run operator:create -- --username maria --name "Maria Souza" --role ADMIN
import { PrismaClient } from '@prisma/client';
import { createOperator } from '../application/auth';
import { ROLES, usernameSchema, type Role } from '../domain/auth/auth';
import { PrismaAuditRepository, PrismaAuthRepository } from '../infra/prisma/authRepository';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Lê uma linha do terminal sem mostrar o que é digitado. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('Execute em um terminal interativo.'));
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const username = usernameSchema.safeParse(arg('username'));
  const name = arg('name')?.trim();
  const role = (arg('role') ?? 'RECEPTION') as Role;
  if (!username.success || !name || name.length < 2 || !ROLES.includes(role)) {
    console.error('Uso: npm run operator:create -- --username maria --name "Maria Souza" --role ADMIN|MANAGER|RECEPTION');
    process.exitCode = 1;
    return;
  }
  const password = await readHidden('Senha (mínimo 12 caracteres): ');
  if (password !== (await readHidden('Repita a senha: '))) {
    console.error('As senhas não conferem.');
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const deps = { repo: new PrismaAuthRepository(prisma), audit: new PrismaAuditRepository(prisma) };
    const op = await createOperator(deps, { username: username.data, name, role, password });
    await deps.audit.record({
      at: new Date(),
      operatorId: null,
      operatorName: 'linha de comando',
      action: 'operator.create',
      entity: 'operator',
      entityId: op.operatorId,
      ok: true,
      details: { role },
    });
    console.log(`Funcionário criado: ${op.username} (${op.role}).`);
  } catch (e) {
    console.error('Não foi possível criar:', (e as Error).message || (e as Error).name);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

void main();
