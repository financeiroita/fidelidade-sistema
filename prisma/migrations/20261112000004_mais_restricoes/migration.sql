-- Mais restrições de integridade (revisão geral de 2026-11-12, ADR 0016).
-- Rede de segurança: se um bug tentar gravar um dado incoerente, o banco recusa.

-- Pontos-base nunca são negativos.
ALTER TABLE "PointsTransaction"
  ADD CONSTRAINT "PointsTransaction_qualifying_nonneg" CHECK ("qualifyingPts" >= 0);

-- Lote com saldo sempre tem validade (sem validade, nunca seria usado nem vencido).
ALTER TABLE "PointsTransaction"
  ADD CONSTRAINT "PointsTransaction_lot_has_expiry" CHECK ("remaining" = 0 OR "expiresAt" IS NOT NULL);

ALTER TABLE "Reward"
  ADD CONSTRAINT "Reward_cost_positive" CHECK ("pointsCost" > 0);

ALTER TABLE "Reward"
  ADD CONSTRAINT "Reward_min_tier_nonneg" CHECK ("minTierRank" >= 0);

ALTER TABLE "Stay"
  ADD CONSTRAINT "Stay_dates_in_order" CHECK ("checkOut" >= "checkIn");

ALTER TABLE "Stay"
  ADD CONSTRAINT "Stay_nights_nonneg" CHECK ("nights" >= 0);

ALTER TABLE "ExpiryNotice"
  ADD CONSTRAINT "ExpiryNotice_points_positive" CHECK ("points" > 0);

ALTER TABLE "Operator"
  ADD CONSTRAINT "Operator_failed_attempts_nonneg" CHECK ("failedAttempts" >= 0);

ALTER TABLE "GuestSession"
  ADD CONSTRAINT "GuestSession_expires_after_creation" CHECK ("expiresAt" > "createdAt");
