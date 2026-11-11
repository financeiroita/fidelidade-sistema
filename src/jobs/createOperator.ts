// Cria um funcionário com login (o primeiro deve ser ADMIN). A senha é pedida no terminal,
// sem aparecer na tela nem ficar no histórico de comandos:
//   npm run operator:create -- --username maria --name "Maria Souza" --role ADMIN
import { PrismaClient } from '@prisma/client';
import { createOperator } from '../application/auth';
import { DuplicateOperatorError, WeakPasswordError } from '../application/ports';
import { ROLES, usernameSchema, type Role } from '../domain/auth/auth';
import { PrismaAuditRepository, PrismaAuthRepository } from '../infra/prisma/authRepository';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Lê uma linha do terminal sem mostrar o que é digitado. Ignora setas e teclas de controle. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error('Execute em um terminal interativo.'));
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value: string[] = []; // por caractere (pares de substituição não se partem no backspace)
    const restore = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };
    const onData = (chunk: string) => {
      if (chunk.startsWith('\u001b')) return; // setas e outras teclas de escape
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          restore();
          process.stdout.write('\n');
          return resolve(value.join(''));
        }
        if (ch === '\u0003') {
          restore(); // Ctrl+C: devolve o terminal ao normal antes de sair
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value.pop();
        else if (ch >= ' ') value.push(ch);
      }
    };
    stdin.on('data', onData);
  });
}

/** Mensagem segura: só o tipo do erro, nunca o texto que o banco devolve. */
const describe = (e: unknown) => {
  if (e instanceof DuplicateOperatorError) return 'Esse usuário já existe.';
  if (e instanceof WeakPasswordError) return e.message;
  const x = e as { code?: string; name?: string };
  return `erro ${x?.code ?? x?.name ?? 'desconhecido'}`;
};

async function main() {
  const username = usernameSchema.safeParse(arg('username'));
  const name = arg('name')?.trim();
  const role = (arg('role') ?? 'RECEPTION') as Role;
  if (!username.success || !name || name.length < 2 || !ROLES.includes(role)) {
    console.error('Uso: npm run operator:create -- --username maria --name "Maria Souza" --role ADMIN|MANAGER|RECEPTION');
    process.exitCode = 1;
    return;
  }
  let password: string;
  try {
    password = await readHidden('Senha (mínimo 12 caracteres): ');
    if (password !== (await readHidden('Repita a senha: '))) {
      console.error('As senhas não conferem.');
      process.exitCode = 1;
      return;
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const deps = { repo: new PrismaAuthRepository(prisma), audit: new PrismaAuditRepository(prisma) };
    let op;
    try {
      op = await createOperator(deps, { username: username.data, name, role, password });
    } catch (e) {
      console.error('Não foi possível criar:', describe(e));
      process.exitCode = 1;
      return;
    }
    console.log(`Funcionário criado: ${op.username} (${op.role}).`);
    // O registro de auditoria é separado: se falhar, o funcionário já foi criado.
    try {
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
    } catch (e) {
      console.error('Aviso: o funcionário foi criado, mas o registro de auditoria falhou:', describe(e));
    }
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error('Falha:', describe(e));
  process.exitCode = 1;
});
