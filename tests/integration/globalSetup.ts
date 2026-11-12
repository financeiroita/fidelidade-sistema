import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const PORT = 54329;

/** Sobe um PostgreSQL temporário, aplica as migrações do projeto (inclusive as restrições) e o derruba no fim. */
export default async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fidelidade-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'fidelidade',
    password: 'teste',
    port: PORT,
    persistent: false,
    onLog: () => undefined,
    onError: () => undefined,
  });
  const stop = async () => {
    await pg.stop().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  };
  const url = `postgresql://fidelidade:teste@localhost:${PORT}/fidelidade_test`;
  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('fidelidade_test');
    process.env.DATABASE_URL = url;
    execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  } catch (e) {
    await stop();
    throw e;
  }
  return stop;
}
