import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  adminResetPassword,
  audit,
  authenticate,
  changeOwnPassword,
  createOperator,
  listOperators,
  login,
  logout,
  setOperatorActive,
  type AuthDeps,
} from '../application/auth';
import { processCheckout, registerStay, type LoyaltyDeps } from '../application/checkout';
import {
  CannotDeactivateSelfError,
  CannotResetOwnPasswordError,
  DuplicateGuestError,
  DuplicateOperatorError,
  DuplicateStayError,
  StayOutOfPeriodError,
  GuestNotFoundError,
  InsufficientPointsError,
  InvalidCredentialsError,
  InvalidStayError,
  InvalidTransitionError,
  LastAdminError,
  OperatorNotFoundError,
  RedemptionNotFoundError,
  RequestIdReusedError,
  RewardNotAvailableError,
  StayNotEligibleError,
  StayNotFoundError,
  TierTooLowError,
  WeakPasswordError,
} from '../application/ports';
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
import { signupGuest, type SignupDeps } from '../application/signup';
import {
  auditQuerySchema,
  can,
  changePasswordSchema,
  createOperatorSchema,
  loginSchema,
  resetPasswordSchema,
  type Permission,
  type Principal,
} from '../domain/auth/auth';
import { signupSchema } from '../domain/guests/signup';
import { redeemSchema, rewardInputSchema, rewardPatchSchema, useSchema } from '../domain/rewards/reward';
import { stayInputSchema } from '../domain/stays/stay';
import { ServiceBusyError } from '../infra/security/limiter';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
    bearer: string | null;
  }
}

export interface AppDeps {
  signup: SignupDeps;
  loyalty: LoyaltyDeps;
  rewards: RewardDeps;
  auth: AuthDeps;
}

export interface AppOptions {
  logger?: boolean;
  /**
   * Endereços/faixas (IP ou CIDR) dos proxies SEUS cujo X-Forwarded-For é aceito (ou false).
   * Nunca "todos" nem só uma contagem de saltos: quem conecta direto poderia forjar o IP (ADR 0012).
   */
  trustProxy?: string[] | false;
  /** Pedidos por minuto, por IP, nas rotas abertas e sensíveis. */
  limits?: { login?: number; password?: number; guests?: number };
}

const validationError = (issues: Array<{ path: Array<string | number>; message: string }>) => ({
  error: 'validation_error',
  issues: issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
});

const isUuid = (v: string) => z.string().uuid().safeParse(v).success;

/** Monta a API. Recebe as dependências para poder ser testada sem banco. */
export function buildApp(deps: AppDeps, opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ? { redact: ['req.headers.authorization'] } : false,
    bodyLimit: 64 * 1024,
    // Só aceita o X-Forwarded-For quando quem conecta é um proxy da lista.
    trustProxy: opts.trustProxy && opts.trustProxy.length > 0 ? opts.trustProxy : false,
    // Conexões lentas de propósito não ficam penduradas.
    connectionTimeout: 30_000,
    requestTimeout: 30_000,
  });
  app.decorateRequest('principal', null);
  app.decorateRequest('bearer', null);

  // Respostas levam token e dados pessoais: nunca ficam em cache.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
  });

  const limits = { login: 10, password: 10, guests: 20, ...opts.limits };
  const limitOf = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

  app.register(rateLimit, { global: false });

  // Todas as rotas ficam dentro deste plugin, que carrega depois do limite de requisições.
  app.register(async (api) => {
    /** Registra no histórico de auditoria quem fez o quê (sem dados pessoais). */
    const record = (req: FastifyRequest, action: string, extra: Parameters<typeof audit>[3] = {}) =>
      audit(deps.auth, req.principal, action, extra, (code) =>
        app.log.error({ errCode: code }, 'falha ao gravar a auditoria'),
      );

    /** Exige a permissão; a tentativa negada fica registrada. */
    const guard = (permission: Permission) => async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.principal || !can(req.principal.role, permission)) {
        await record(req, 'auth.denied', { ok: false, details: { permission } });
        return reply.code(403).send({ error: 'forbidden' });
      }
    };

    // Traduz os erros de negócio em respostas HTTP; o resto cai no tratador geral.
    const businessError = (e: unknown, reply: FastifyReply) => {
      if (e instanceof GuestNotFoundError) return reply.code(404).send({ error: 'guest_not_found' });
      if (e instanceof RewardNotAvailableError) return reply.code(404).send({ error: 'reward_not_available' });
      if (e instanceof RedemptionNotFoundError) return reply.code(404).send({ error: 'redemption_not_found' });
      if (e instanceof OperatorNotFoundError) return reply.code(404).send({ error: 'operator_not_found' });
      if (e instanceof TierTooLowError) return reply.code(403).send({ error: 'tier_too_low' });
      if (e instanceof InsufficientPointsError) {
        return reply.code(409).send({ error: 'insufficient_points', available: e.available });
      }
      if (e instanceof InvalidTransitionError) return reply.code(409).send({ error: 'invalid_transition' });
      if (e instanceof InvalidStayError) return reply.code(422).send({ error: 'invalid_stay' });
      if (e instanceof RequestIdReusedError) return reply.code(409).send({ error: 'request_id_reused' });
      if (e instanceof DuplicateStayError) return reply.code(409).send({ error: 'duplicate_stay' });
      if (e instanceof StayOutOfPeriodError) {
        return reply.code(422).send({ error: 'stay_out_of_period', message: e.message });
      }
      if (e instanceof DuplicateOperatorError) return reply.code(409).send({ error: 'duplicate_operator' });
      if (e instanceof CannotDeactivateSelfError) return reply.code(409).send({ error: 'cannot_deactivate_self' });
      if (e instanceof LastAdminError) return reply.code(409).send({ error: 'last_admin' });
      if (e instanceof CannotResetOwnPasswordError) {
        return reply.code(409).send({ error: 'use_own_password_route' });
      }
      if (e instanceof StayNotFoundError) return reply.code(404).send({ error: 'stay_not_found' });
      if (e instanceof StayNotEligibleError) return reply.code(409).send({ error: 'stay_not_eligible' });
      if (e instanceof InvalidCredentialsError) return reply.code(401).send({ error: 'invalid_credentials' });
      if (e instanceof WeakPasswordError) return reply.code(422).send({ error: 'weak_password', message: e.message });
      if (e instanceof ServiceBusyError) {
        return reply.header('retry-after', '5').code(503).send({ error: 'busy' });
      }
      throw e;
    };

    // ---------- Rotas públicas ----------
    api.get('/health', async () => ({ status: 'ok' }));

    api.post('/guests', limitOf(limits.guests), async (req, reply) => {
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

    // Catálogo de prêmios: só o que o hóspede precisa ver.
    api.get('/rewards', async () =>
      (await listRewards(deps.rewards)).map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        pointsCost: r.pointsCost,
        description: r.description ?? null,
        minTierRank: r.minTierRank,
      })),
    );

    api.post('/auth/login', { bodyLimit: 1024, ...limitOf(limits.login) }, async (req, reply) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(401).send({ error: 'invalid_credentials' });
      try {
        const r = await login(deps.auth, parsed.data);
        return reply.send({ token: r.token, expiresAt: r.expiresAt, operator: r.operator });
      } catch (e) {
        return businessError(e, reply);
      }
    });

    // ---------- Rotas internas: exigem login (Authorization: Bearer <token>) ----------
    api.register(async (internal) => {
      internal.addHook('onRequest', async (req, reply) => {
        const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(String(req.headers.authorization ?? ''));
        const principal = m ? await authenticate(deps.auth, m[1]) : null;
        if (!m || !principal) return reply.code(401).send({ error: 'unauthorized' });
        req.principal = principal;
        req.bearer = m[1];
      });

      // --- sessão e conta própria ---
      internal.get('/auth/me', async (req) => req.principal);

      internal.post('/auth/logout', async (req, reply) => {
        await logout(deps.auth, req.bearer as string);
        await record(req, 'auth.logout');
        return reply.code(204).send();
      });

      internal.post('/auth/password', { bodyLimit: 1024, ...limitOf(limits.password) }, async (req, reply) => {
        const parsed = changePasswordSchema.safeParse(req.body);
        if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
        try {
          await changeOwnPassword(deps.auth, req.principal as Principal, req.bearer as string, parsed.data);
          await record(req, 'auth.password-change');
          return reply.code(204).send();
        } catch (e) {
          await record(req, 'auth.password-change', { ok: false });
          return businessError(e, reply);
        }
      });

      // --- funcionários (administrador) ---
      internal.get('/operators', { preHandler: guard('operator:admin') }, async () => listOperators(deps.auth));

      internal.post('/operators', { preHandler: guard('operator:admin') }, async (req, reply) => {
        const parsed = createOperatorSchema.safeParse(req.body);
        if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
        try {
          const op = await createOperator(deps.auth, parsed.data);
          await record(req, 'operator.create', { entity: 'operator', entityId: op.operatorId, details: { role: op.role } });
          return reply.code(201).send(op);
        } catch (e) {
          return businessError(e, reply);
        }
      });

      for (const [path, active] of [['deactivate', false], ['activate', true]] as const) {
        internal.post<{ Params: { id: string } }>(
          `/operators/:id/${path}`,
          { preHandler: guard('operator:admin') },
          async (req, reply) => {
            if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'operator_not_found' });
            try {
              await setOperatorActive(deps.auth, req.principal as Principal, req.params.id, active);
              await record(req, `operator.${path}`, { entity: 'operator', entityId: req.params.id });
              return reply.code(204).send();
            } catch (e) {
              return businessError(e, reply);
            }
          },
        );
      }

      internal.post<{ Params: { id: string } }>(
        '/operators/:id/password',
        { preHandler: guard('operator:admin'), bodyLimit: 1024 },
        async (req, reply) => {
          if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'operator_not_found' });
          const parsed = resetPasswordSchema.safeParse(req.body);
          if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
          try {
            await adminResetPassword(deps.auth, req.principal as Principal, req.params.id, parsed.data.password);
            await record(req, 'operator.password-reset', { entity: 'operator', entityId: req.params.id });
            return reply.code(204).send();
          } catch (e) {
            return businessError(e, reply);
          }
        },
      );

      // --- auditoria (gerente): a própria consulta também fica registrada ---
      internal.get('/audit', { preHandler: guard('audit:read') }, async (req, reply) => {
        const parsed = auditQuerySchema.safeParse(req.query);
        if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
        const { entity, entityId, operatorId } = parsed.data;
        const limit = Math.min(200, Math.max(1, parsed.data.limit || 50));
        const rows = await deps.auth.audit.list({ entity, entityId, operatorId, limit });
        await record(req, 'audit.read', { details: { filtered: !!(entity || entityId || operatorId) } });
        return reply.send(rows);
      });

      // --- estadias e check-out ---
      internal.post('/stays', { preHandler: guard('stay:write') }, async (req, reply) => {
        const parsed = stayInputSchema.safeParse(req.body);
        if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
        try {
          const r = await registerStay(deps.loyalty, parsed.data);
          const total = parsed.data.charges.reduce((s, c) => s + c.amount, 0);
          await record(req, 'stay.create', {
            entity: 'stay',
            entityId: r.id,
            details: {
              guestId: parsed.data.guestId,
              channel: parsed.data.channel,
              total: Math.round(total * 100) / 100,
            },
          });
          return reply.code(201).send(r);
        } catch (e) {
          return businessError(e, reply);
        }
      });

      internal.post<{ Params: { id: string } }>(
        '/stays/:id/checkout',
        { preHandler: guard('checkout:run') },
        async (req, reply) => {
          if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'stay_not_found' });
          try {
            const r = await processCheckout(deps.loyalty, req.params.id);
            await record(req, 'stay.checkout', {
              entity: 'stay',
              entityId: req.params.id,
              details: { earned: r.earned, alreadyProcessed: r.alreadyProcessed },
            });
            return reply.send(r);
          } catch (e) {
            return businessError(e, reply);
          }
        },
      );

      // --- prêmios, resgates, saldo ---
      internal.post('/rewards', { preHandler: guard('reward:write') }, async (req, reply) => {
        const parsed = rewardInputSchema.safeParse(req.body);
        if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
        const r = await createReward(deps.rewards, parsed.data);
        await record(req, 'reward.create', { entity: 'reward', entityId: r.id, details: { pointsCost: r.pointsCost } });
        return reply.code(201).send(r);
      });

      internal.patch<{ Params: { id: string } }>(
        '/rewards/:id',
        { preHandler: guard('reward:write') },
        async (req, reply) => {
          if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'reward_not_available' });
          const parsed = rewardPatchSchema.safeParse(req.body);
          if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
          try {
            const r = await updateReward(deps.rewards, req.params.id, parsed.data);
            await record(req, 'reward.update', {
              entity: 'reward',
              entityId: r.id,
              details: { fields: Object.keys(parsed.data).join(',') },
            });
            return reply.send(r);
          } catch (e) {
            return businessError(e, reply);
          }
        },
      );

      internal.post('/redemptions', { preHandler: guard('redemption:create') }, async (req, reply) => {
        const parsed = redeemSchema.safeParse(req.body);
        if (!parsed.success) return reply.code(422).send(validationError(parsed.error.issues));
        try {
          const { redemption, replay } = await redeem(deps.rewards, parsed.data);
          if (!replay) {
            await record(req, 'redemption.create', {
              entity: 'redemption',
              entityId: redemption.id,
              details: { guestId: redemption.guestId, points: redemption.points },
            });
          }
          return reply.code(replay ? 200 : 201).send({ ...redemption, replay });
        } catch (e) {
          return businessError(e, reply);
        }
      });

      const permissionOf = { confirm: 'redemption:confirm', use: 'redemption:use', cancel: 'redemption:cancel' } as const;
      for (const action of ['confirm', 'use', 'cancel'] as RedemptionAction[]) {
        internal.post<{ Params: { id: string } }>(
          `/redemptions/:id/${action}`,
          { preHandler: guard(permissionOf[action]) },
          async (req, reply) => {
            if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'redemption_not_found' });
            const body = useSchema.safeParse(req.body ?? {});
            if (!body.success) return reply.code(422).send(validationError(body.error.issues));
            try {
              const r = await changeRedemption(deps.rewards, req.params.id, action, body.data);
              await record(req, `redemption.${action}`, {
                entity: 'redemption',
                entityId: r.id,
                details: { points: r.points, status: r.status },
              });
              return reply.send(r);
            } catch (e) {
              return businessError(e, reply);
            }
          },
        );
      }

      // Consultar dados do hóspede também fica registrado (LGPD: quem acessou o quê).
      internal.get<{ Params: { id: string } }>(
        '/guests/:id/balance',
        { preHandler: guard('guest:read-points') },
        async (req, reply) => {
          if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'guest_not_found' });
          try {
            const b = await getBalance(deps.rewards, req.params.id);
            await record(req, 'guest.balance', { entity: 'guest', entityId: req.params.id });
            return reply.send(b);
          } catch (e) {
            return businessError(e, reply);
          }
        },
      );

      internal.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
        '/guests/:id/statement',
        { preHandler: guard('guest:read-points') },
        async (req, reply) => {
          if (!isUuid(req.params.id)) return reply.code(404).send({ error: 'guest_not_found' });
          const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit ?? '50', 10) || 50));
          try {
            await getBalance(deps.rewards, req.params.id); // 404 se o hóspede não existe
            const rows = await getStatement(deps.rewards, req.params.id, limit);
            await record(req, 'guest.statement', { entity: 'guest', entityId: req.params.id });
            return reply.send(rows);
          } catch (e) {
            return businessError(e, reply);
          }
        },
      );
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
    if (status === 429) return reply.code(429).send({ error: 'too_many_requests' });
    return reply.code(status).send({ error: 'bad_request' });
  });

  return app;
}
