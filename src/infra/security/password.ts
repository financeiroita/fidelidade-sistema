import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { createLimiter } from './limiter';

// scrypt com 32 MB de memória por tentativa: caro para quem tenta adivinhar senhas em massa.
const N = 32768;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const OPTIONS: ScryptOptions = { N, r: R, p: P, maxmem: 128 * 1024 * 1024 };

// No máximo 4 senhas sendo processadas ao mesmo tempo (memória e CPU limitadas) e 64 esperando.
// Passou disso, recusa na hora (ServiceBusyError): uma rajada de logins não trava o servidor
// e não adianta como força bruta paralela.
const limited = createLimiter(4, 64);

const derive = (password: string, salt: Buffer, opts: ScryptOptions = OPTIONS) =>
  limited(
    () =>
      new Promise<Buffer>((resolve, reject) =>
        scrypt(password.normalize('NFKC'), salt, KEY_LEN, opts, (err, key) => (err ? reject(err) : resolve(key))),
      ),
  );

/** Formato: scrypt$N$r$p$sal$hash (base64). Guarda os parâmetros para poder fortalecer no futuro. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(password, Buffer.from(salt, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash fixo para gastar o mesmo tempo quando o usuário não existe (não revela quem existe). */
let dummy: Promise<string> | undefined;
export async function burnPasswordTime(password: string): Promise<void> {
  dummy ??= hashPassword('senha-ficticia-para-igualar-o-tempo').catch((e) => {
    dummy = undefined; // uma falha não fica guardada para sempre
    throw e;
  });
  await verifyPassword(password, await dummy);
}

/** Calcula o hash fictício na partida, para o primeiro login de usuário inexistente não demorar o dobro. */
export const warmUpPasswordHashing = () => burnPasswordTime('x');
