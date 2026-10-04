-- Verified Kaspi receipt identity and duplicate protection

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "receiptHash" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptKey" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "receiptDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "receiptMerchantBin" TEXT,
  ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_receiptHash_key"
  ON "Payment"("receiptHash")
  WHERE "receiptHash" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Payment_receiptKey_key"
  ON "Payment"("receiptKey")
  WHERE "receiptKey" IS NOT NULL;
