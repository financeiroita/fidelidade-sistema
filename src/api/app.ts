import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { processCheckout, registerStay, type LoyaltyDeps } from '../application/checkout';
import {
  DuplicateGuestError,
  GuestNotFoundError,
  StayNotEligibleError,
  StayNotFoundError,
} from '../application/ports';
import { signupGuest, type SignupDeps } from '../application/signup';
import { signupSchema } from '../domain/guests/signup';
import { stayInputSchema } from '../domain/stays/stay';

export interface AppDeps {
  signup: SignupDeps;
  loyalty: LoyaltyDeps;
  /** Chave das rotas internas (recepção/PMS). Rotas públicas: /health e POST /guests. */
  internalApiKey: string;
}

const digest = (v: string) => createHash('sha256').update(v).digest();
const validKey = (given: unknown, expected: string) =>
  typeof given === 'string' && timingSafeEqual(digest(given), digest(expected));

const validationError = (issues: Array<{ path: Array<string | number>; message: string }>) => ({
  error: 'validation_error',
  issues: issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
});

/** Monta a API. Recebe as dependências para poder ser testada sem banco. */
export function buildApp(deps: AppDeps, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ? { redact: ['req.headers.authorization', 'req.headers["x-api-key"]'] } : false,
    bodyLimit: 64 * 1024,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/guests', async (req, reply) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
    try {
      return reply.code(201).send(await signupGuest(deps.signup, parsed.data));
    } catch (e) {
      if (e instanceof DuplicateGuestError) {
        return reply.code(409).send({ error: 'duplicate_guest', message: 'Já existe um cadastro com estes dados.' });
      }
      throw e;
    }
  });

  // Rotas internas: exigem a chave no cabeçalho x-api-key.
  app.register(async (internal) => {
    internal.addHook('onRequest', async (req, reply) => {
      if (!validKey(req.headers['x-api-key'], deps.internalApiKey)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
    });

    internal.post('/stays', async (req, reply) => {
      const parsed = stayInputSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
      try {
        return reply.code(201).send(await registerStay(deps.loyalty, parsed.data));
      } catch (e) {
        if (e instanceof GuestNotFoundError) return reply.code(404).send({ error: 'guest_not_found' });
        throw e;
      }
    });

    internal.post<{ Params: { id: string } }>('/stays/:id/checkout', async (req, reply) => {
      try {
        return reply.send(await processCheckout(deps.loyalty, req.params.id));
      } catch (e) {
        if (e instanceof StayNotFoundError) return reply.code(404).send({ error: 'stay_not_found' });
        if (e instanceof StayNotEligibleError) return reply.code(409).send({ error: 'stay_not_eligible' });
        throw e;
      }
    });
  });

  // Nunca devolve detalhes internos nem dados do corpo da requisição.
  app.setErrorHandler((err: { statusCode?: number; message?: string }, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      app.log.error({ err: { message: err.message } }, 'erro interno');
      return reply.code(500).send({ error: 'internal_error' });
    }
    return reply.code(status).send({ error: 'bad_request' });
  });

  return app;
}
