import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { processCheckout, registerStay, type LoyaltyDeps } from '../application/checkout';
import { z } from 'zod';
import {
  DuplicateGuestError,
  DuplicateStayError,
  GuestNotFoundError,
  StayNotEligibleError,
  StayNotFoundError,
} from '../application/ports';
import { signupGuest, type SignupDeps } from '../application/signup';
import {
  changeRedemption,
  createReward,
  getBalance,
  getStatement,
  listRewards,
  redeem,
  updateReward,
  type RedemptionAction,
  type RewardDeps,
} from '../application/redemptions';
import { redeemSchema, rewardInputSchema, rewardPatchSchema, useSchema } from '../domain/rewards/reward';
import {
  InsufficientPointsError,
  InvalidStayError,
  InvalidTransitionError,
  RedemptionNotFoundError,
  RequestIdReusedError,
  RewardNotAvailableError,
  TierTooLowError,
} from '../application/ports';
import { signupSchema } from '../domain/guests/signup';
import { stayInputSchema } from '../domain/stays/stay';

export interface AppDeps {
  signup: SignupDeps;
  loyalty: LoyaltyDeps;
  rewards: RewardDeps;
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

  // Catálogo de prêmios: público, só o que o hóspede precisa ver.
  app.get('/rewards', async () =>
    (await listRewards(deps.rewards)).map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      pointsCost: r.pointsCost,
      description: r.description ?? null,
      minTierRank: r.minTierRank,
    })),
  );

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
        if (e instanceof DuplicateStayError) return reply.code(409).send({ error: 'duplicate_stay' });
        throw e;
      }
    });

    const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

    // Traduz os erros de negócio do resgate em respostas HTTP; o resto cai no tratador geral.
    const rewardError = (e: unknown, reply: import('fastify').FastifyReply) => {
      if (e instanceof GuestNotFoundError) return reply.code(404).send({ error: 'guest_not_found' });
      if (e instanceof RewardNotAvailableError) return reply.code(404).send({ error: 'reward_not_available' });
      if (e instanceof RedemptionNotFoundError) return reply.code(404).send({ error: 'redemption_not_found' });
      if (e instanceof TierTooLowError) return reply.code(403).send({ error: 'tier_too_low' });
      if (e instanceof InsufficientPointsError) {
        return reply.code(409).send({ error: 'insufficient_points', available: e.available });
      }
      if (e instanceof InvalidTransitionError) return reply.code(409).send({ error: 'invalid_transition' });
      if (e instanceof InvalidStayError) return reply.code(422).send({ error: 'invalid_stay' });
      if (e instanceof RequestIdReusedError) return reply.code(409).send({ error: 'request_id_reused' });
      throw e;
    };

    internal.post('/rewards', async (req, reply) => {
      const parsed = rewardInputSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
      return reply.code(201).send(await createReward(deps.rewards, parsed.data));
    });

    internal.patch<{ Params: { id: string } }>('/rewards/:id', async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'reward_not_available' });
      const parsed = rewardPatchSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
      try {
        return reply.send(await updateReward(deps.rewards, req.params.id, parsed.data));
      } catch (e) {
        return rewardError(e, reply);
      }
    });

    internal.post('/redemptions', async (req, reply) => {
      const parsed = redeemSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
      try {
        const { redemption, replay } = await redeem(deps.rewards, parsed.data);
        return reply.code(replay ? 200 : 201).send({ ...redemption, replay });
      } catch (e) {
        return rewardError(e, reply);
      }
    });

    for (const action of ['confirm', 'use', 'cancel'] as RedemptionAction[]) {
      internal.post<{ Params: { id: string } }>(`/redemptions/:id/${action}`, async (req, reply) => {
        if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'redemption_not_found' });
        const body = useSchema.safeParse(req.body ?? {});
        if (!body.success) return reply.code(422).send(validationError(body.error.issues));
        try {
          return reply.send(await changeRedemption(deps.rewards, req.params.id, action, body.data));
        } catch (e) {
          return rewardError(e, reply);
        }
      });
    }

    internal.get<{ Params: { id: string } }>('/guests/:id/balance', async (req, reply) => {
      if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'guest_not_found' });
      try {
        return reply.send(await getBalance(deps.rewards, req.params.id));
      } catch (e) {
        return rewardError(e, reply);
      }
    });

    internal.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
      '/guests/:id/statement',
      async (req, reply) => {
        if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'guest_not_found' });
        const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit ?? '50', 10) || 50));
        try {
          await getBalance(deps.rewards, req.params.id); // 404 se o hóspede não existe
          return reply.send(await getStatement(deps.rewards, req.params.id, limit));
        } catch (e) {
          return rewardError(e, reply);
        }
      },
    );

    internal.post<{ Params: { id: string } }>('/stays/:id/checkout', async (req, reply) => {
      if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: 'stay_not_found' });
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
  app.setErrorHandler((err: { statusCode?: number; name?: string; code?: string }, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      // Só o tipo do erro: mensagens do Prisma podem conter dados pessoais do corpo da requisição.
      app.log.error({ errName: err.name, errCode: err.code }, 'erro interno');
      return reply.code(500).send({ error: 'internal_error' });
    }
    return reply.code(status).send({ error: 'bad_request' });
  });

  return app;
}
