-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CPF', 'PASSPORT');

-- CreateEnum
CREATE TYPE "StaySource" AS ENUM ('PMS', 'MANUAL');

-- CreateEnum
CREATE TYPE "StayStatus" AS ENUM ('RESERVED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('DIRECT_WEBSITE', 'PHONE', 'WHATSAPP', 'WALK_IN', 'OTA', 'CORPORATE', 'AGENCY');

-- CreateEnum
CREATE TYPE "ChargeCategory" AS ENUM ('ROOM', 'FNB', 'SPA', 'EVENTS', 'OTHER');

-- CreateEnum
CREATE TYPE "PointsTxType" AS ENUM ('EARN_STAY', 'EARN_CHARGE', 'EARN_BONUS', 'EARN_CAMPAIGN', 'REDEEM', 'EXPIRE', 'ADJUST', 'REVERSAL');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'USED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('FREE_NIGHT', 'UPGRADE', 'DINING', 'SPA', 'DISCOUNT', 'EXPERIENCE');

-- CreateEnum
CREATE TYPE "OperatorRole" AS ENUM ('RECEPTION', 'MANAGER', 'ADMIN');

-- CreateTable
CREATE TABLE "Tier" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "minQualifyingPts" INTEGER NOT NULL,
    "multiplier" DECIMAL(4,2) NOT NULL,
    "benefits" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "Tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guest" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "documentType" "DocumentType" NOT NULL,
    "document" TEXT NOT NULL,
    "documentLast4" TEXT NOT NULL,
    "birthDate" DATE,
    "nationality" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "language" TEXT,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "travelProfile" TEXT,
    "acquisitionSrc" TEXT,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),
    "memberSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tierId" INTEGER NOT NULL,
    "tierValidUntil" TIMESTAMP(3),
    "welcomeBonusPending" INTEGER NOT NULL DEFAULT 0,
    "referralCode" TEXT NOT NULL,
    "referredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stay" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "source" "StaySource" NOT NULL,
    "pmsReservationId" TEXT,
    "channel" "BookingChannel" NOT NULL,
    "status" "StayStatus" NOT NULL,
    "checkIn" DATE NOT NULL,
    "checkOut" DATE NOT NULL,
    "nights" INTEGER NOT NULL,
    "roomType" TEXT,
    "adults" INTEGER NOT NULL DEFAULT 1,
    "children" INTEGER NOT NULL DEFAULT 0,
    "rateCode" TEXT,
    "isDirect" BOOLEAN NOT NULL DEFAULT false,
    "pointsProcessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StayCharge" (
    "id" TEXT NOT NULL,
    "stayId" TEXT NOT NULL,
    "category" "ChargeCategory" NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pmsLineId" TEXT,

    CONSTRAINT "StayCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "multiplier" DECIMAL(4,2),
    "bonusPoints" INTEGER,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointsTransaction" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "type" "PointsTxType" NOT NULL,
    "points" INTEGER NOT NULL,
    "qualifyingPts" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "stayId" TEXT,
    "redemptionId" TEXT,
    "campaignId" TEXT,
    "reversesId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedemptionLot" (
    "id" TEXT NOT NULL,
    "redemptionId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,

    CONSTRAINT "RedemptionLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpiryNotice" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "expiresOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ExpiryNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RewardType" NOT NULL,
    "pointsCost" INTEGER NOT NULL,
    "description" TEXT,
    "minTierRank" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redemption" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "code" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stayId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "OperatorRole" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operatorId" TEXT,
    "operatorName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "details" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tier_name_key" ON "Tier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tier_rank_key" ON "Tier"("rank");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_email_key" ON "Guest"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_document_key" ON "Guest"("document");

-- CreateIndex
CREATE UNIQUE INDEX "Guest_referralCode_key" ON "Guest"("referralCode");

-- CreateIndex
CREATE INDEX "Guest_birthDate_idx" ON "Guest"("birthDate");

-- CreateIndex
CREATE INDEX "Guest_tierId_idx" ON "Guest"("tierId");

-- CreateIndex
CREATE UNIQUE INDEX "Stay_pmsReservationId_key" ON "Stay"("pmsReservationId");

-- CreateIndex
CREATE INDEX "Stay_guestId_checkOut_idx" ON "Stay"("guestId", "checkOut");

-- CreateIndex
CREATE INDEX "Stay_status_checkOut_idx" ON "Stay"("status", "checkOut");

-- CreateIndex
CREATE UNIQUE INDEX "StayCharge_pmsLineId_key" ON "StayCharge"("pmsLineId");

-- CreateIndex
CREATE INDEX "StayCharge_stayId_idx" ON "StayCharge"("stayId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsTransaction_reversesId_key" ON "PointsTransaction"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "PointsTransaction_idempotencyKey_key" ON "PointsTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PointsTransaction_guestId_createdAt_idx" ON "PointsTransaction"("guestId", "createdAt");

-- CreateIndex
CREATE INDEX "PointsTransaction_guestId_expiresAt_idx" ON "PointsTransaction"("guestId", "expiresAt");

-- CreateIndex
CREATE INDEX "PointsTransaction_redemptionId_idx" ON "PointsTransaction"("redemptionId");

-- CreateIndex
CREATE INDEX "RedemptionLot_lotId_idx" ON "RedemptionLot"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "RedemptionLot_redemptionId_lotId_key" ON "RedemptionLot"("redemptionId", "lotId");

-- CreateIndex
CREATE INDEX "ExpiryNotice_sentAt_idx" ON "ExpiryNotice"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpiryNotice_guestId_windowDays_expiresOn_key" ON "ExpiryNotice"("guestId", "windowDays", "expiresOn");

-- CreateIndex
CREATE INDEX "Reward_active_pointsCost_idx" ON "Reward"("active", "pointsCost");

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_code_key" ON "Redemption"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_requestId_key" ON "Redemption"("requestId");

-- CreateIndex
CREATE INDEX "Redemption_guestId_status_idx" ON "Redemption"("guestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_username_key" ON "Operator"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_operatorId_idx" ON "Session"("operatorId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_operatorId_at_idx" ON "AuditLog"("operatorId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "Tier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StayCharge" ADD CONSTRAINT "StayCharge_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_stayId_fkey" FOREIGN KEY ("stayId") REFERENCES "Stay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "Redemption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointsTransaction" ADD CONSTRAINT "PointsTransaction_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "PointsTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionLot" ADD CONSTRAINT "RedemptionLot_redemptionId_fkey" FOREIGN KEY ("redemptionId") REFERENCES "Redemption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionLot" ADD CONSTRAINT "RedemptionLot_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "PointsTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpiryNotice" ADD CONSTRAINT "ExpiryNotice_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "Reward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
