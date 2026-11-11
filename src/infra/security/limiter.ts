/** A fila de espera está cheia: o servidor está ocupado demais para aceitar mais trabalho agora. */
export class ServiceBusyError extends Error {}

/**
 * Limita quantas tarefas pesadas rodam ao mesmo tempo e quantas esperam na fila.
 * Passou da fila, recusa na hora (em vez de empilhar sem fim e travar o servidor).
 */
export function createLimiter(maxRunning: number, maxQueued: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running >= maxRunning) {
      if (queue.length >= maxQueued) throw new ServiceBusyError();
      await new Promise<void>((resolve) => queue.push(resolve)); // a vaga é repassada por quem terminou
    } else {
      running++;
    }
    try {
      return await task();
    } finally {
      const next = queue.shift();
      if (next) next(); // repassa a vaga sem liberar
      else running--;
    }
  };
}
