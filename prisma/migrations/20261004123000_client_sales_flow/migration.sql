-- Client sales flow, RU/KZ and course tariffs

DO $$ BEGIN
  CREATE TYPE "Language" AS ENUM ('RU','KZ');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PrimaryGoal" AS ENUM ('PROFESSIONAL','FAMILY','BEAUTY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "FamilyProblem" AS ENUM ('BACK_NECK','LEGS_SWELLING_FATIGUE','HOME_RELAXATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "BeautyProfession" AS ENUM ('NAILS','HAIR','DEPILATION','LASH_BROW_COSMETOLOGY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "ConversationStep" ADD VALUE IF NOT EXISTS 'LANGUAGE';
ALTER TYPE "ConversationStep" ADD VALUE IF NOT EXISTS 'PRIMARY_GOAL';
ALTER TYPE "ConversationStep" ADD VALUE IF NOT EXISTS 'PROFESSIONAL_EXPERIENCE';
ALTER TYPE "ConversationStep" ADD VALUE IF NOT EXISTS 'FAMILY_PROBLEM';
ALTER TYPE "ConversationStep" ADD VALUE IF NOT EXISTS 'BEAUTY_PROFESSION';
ALTER TYPE "ConversationStep" ADD VALUE IF NOT EXISTS 'COURSE';
ALTER TYPE "ConversationStep" ADD VALUE IF NOT EXISTS 'TARIFF';

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "language" "Language",
  ADD COLUMN IF NOT EXISTS "primaryGoal" "PrimaryGoal",
  ADD COLUMN IF NOT EXISTS "familyProblem" "FamilyProblem",
  ADD COLUMN IF NOT EXISTS "beautyProfession" "BeautyProfession",
  ADD COLUMN IF NOT EXISTS "selectedTariffId" TEXT;

CREATE TABLE IF NOT EXISTS "CourseTariff" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "titleRu" TEXT NOT NULL,
  "titleKz" TEXT,
  "priceKZT" DECIMAL(12,2) NOT NULL,
  "priceRUB" DECIMAL(12,2) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourseTariff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CourseTariff_courseId_code_key" ON "CourseTariff"("courseId","code");
CREATE INDEX IF NOT EXISTS "CourseTariff_courseId_active_sortOrder_idx" ON "CourseTariff"("courseId","active","sortOrder");

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "tariffId" TEXT;
ALTER TABLE "Enrollment" ADD COLUMN IF NOT EXISTS "tariffId" TEXT;
ALTER TABLE "FunnelEvent" ADD COLUMN IF NOT EXISTS "tariffId" TEXT;

DO $$ BEGIN
  ALTER TABLE "CourseTariff"
    ADD CONSTRAINT "CourseTariff_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_selectedTariffId_fkey"
    FOREIGN KEY ("selectedTariffId") REFERENCES "CourseTariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_tariffId_fkey"
    FOREIGN KEY ("tariffId") REFERENCES "CourseTariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Enrollment"
    ADD CONSTRAINT "Enrollment_tariffId_fkey"
    FOREIGN KEY ("tariffId") REFERENCES "CourseTariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FunnelEvent"
    ADD CONSTRAINT "FunnelEvent_tariffId_fkey"
    FOREIGN KEY ("tariffId") REFERENCES "CourseTariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Payment_tariffId_idx" ON "Payment"("tariffId");
CREATE INDEX IF NOT EXISTS "Enrollment_tariffId_idx" ON "Enrollment"("tariffId");
CREATE INDEX IF NOT EXISTS "FunnelEvent_tariffId_idx" ON "FunnelEvent"("tariffId");
