-- DropIndex
DROP INDEX "AuditLog_entity_entityId_idx";

-- CreateIndex
CREATE INDEX "Guest_tierValidUntil_idx" ON "Guest"("tierValidUntil");

-- CreateIndex
CREATE INDEX "Guest_referredById_idx" ON "Guest"("referredById");

-- CreateIndex
CREATE INDEX "PointsTransaction_expiresAt_idx" ON "PointsTransaction"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_at_idx" ON "AuditLog"("entity", "entityId", "at");

