-- Repair durable Telegram polling tables for databases whose initial
-- migration was applied before these tables were added to the baseline.

CREATE TABLE IF NOT EXISTS "TelegramUpdate" (
    "id" BIGINT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TelegramUpdate_processedAt_id_idx"
ON "TelegramUpdate"("processedAt", "id");

CREATE TABLE IF NOT EXISTS "WorkerLease" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerLease_pkey" PRIMARY KEY ("id")
);
