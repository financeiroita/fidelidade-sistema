-- Área do hóspede (ADR 0013): código de acesso por e-mail e sessão do hóspede.

-- CreateTable
CREATE TABLE "GuestLoginCode" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestLoginCode_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GuestLoginCode_attempts_check" CHECK ("attempts" >= 0)
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestLoginCode_guestId_createdAt_idx" ON "GuestLoginCode"("guestId", "createdAt");

-- CreateIndex
CREATE INDEX "GuestLoginCode_expiresAt_idx" ON "GuestLoginCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_tokenHash_key" ON "GuestSession"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestSession_guestId_idx" ON "GuestSession"("guestId");

-- CreateIndex
CREATE INDEX "GuestSession_expiresAt_idx" ON "GuestSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "GuestLoginCode" ADD CONSTRAINT "GuestLoginCode_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
