import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { GlobalSetupContext } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** Pede ao sistema uma porta livre (evita conflito com outro PostgreSQL ou outra execução). */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

/** Pastas de execuções anteriores que foram interrompidas (Ctrl+C) e não se limparam. */
function removeStaleDirs() {
  for (const n of readdirSync(tmpdir())) {
    if (n.startsWith('fidelidade-pg-')) rmSync(path.join(tmpdir(), n), { recursive: true, force: true });
  }
}

/**
 * Sobe um PostgreSQL temporário, aplica as migrações do projeto (inclusive as restrições) e o derruba no fim.
 * Se uma execução anterior foi morta no meio, pode sobrar um postgres.exe: encerre-o no Gerenciador de Tarefas.
 */
export default async function setup({ provide }: GlobalSetupContext) {
  try {
    removeStaleDirs();
  } catch {
    /* pasta em uso por outra execução: ignora */
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'fidelidade-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'fidelidade',
    password: 'teste',
    port,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  const stop = async () => {
    await pg.stop().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  };
  const url = `postgresql://fidelidade:teste@127.0.0.1:${port}/fidelidade_test`;
  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('fidelidade_test');
    // A URL vai aos testes por provide/inject, sem mexer no DATABASE_URL do seu ambiente de desenvolvimento.
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
    provide('databaseUrl', url);
  } catch (e) {
    await stop();
    throw e;
  }
  return stop;
}
