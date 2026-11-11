import Fastify, { type FastifyInstance } from 'fastify';
import { signupGuest, type SignupDeps } from '../application/signup';
import { DuplicateGuestError } from '../application/ports';
import { signupSchema } from '../domain/guests/signup';

/** Monta a API. Recebe as dependências para poder ser testada sem banco. */
export function buildApp(deps: SignupDeps, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ? { redact: ['req.headers.authorization'] } : false,
    bodyLimit: 16 * 1024,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/guests', async (req, reply) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(422).send({
        error: 'validation_error',
        issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    try {
      const result = await signupGuest(deps, parsed.data);
      return reply.code(201).send(result);
    } catch (e) {
      if (e instanceof DuplicateGuestError) {
        return reply.code(409).send({ error: 'duplicate_guest', message: 'Já existe um cadastro com estes dados.' });
      }
      throw e;
    }
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
