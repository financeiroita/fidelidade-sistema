-- Restrições de integridade que o Prisma não declara no schema.
-- Aplicadas automaticamente por `prisma migrate`, depois da migração init.
-- Servem de rede de segurança: se um bug tentar gravar saldo incoerente, o banco recusa.

ALTER TABLE "PointsTransaction"
  ADD CONSTRAINT "PointsTransaction_remaining_nonneg" CHECK ("remaining" >= 0);

-- Lote de crédito nunca tem mais saldo do que creditou.
ALTER TABLE "PointsTransaction"
  ADD CONSTRAINT "PointsTransaction_remaining_le_points" CHECK ("remaining" = 0 OR "remaining" <= "points");

ALTER TABLE "Redemption"
  ADD CONSTRAINT "Redemption_points_positive" CHECK ("points" > 0);

ALTER TABLE "RedemptionLot"
  ADD CONSTRAINT "RedemptionLot_points_positive" CHECK ("points" > 0);

ALTER TABLE "Guest"
  ADD CONSTRAINT "Guest_welcome_nonneg" CHECK ("welcomeBonusPending" >= 0);
