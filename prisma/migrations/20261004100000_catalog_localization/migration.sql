BEGIN;

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('RU', 'KZ');

-- CreateEnum
CREATE TYPE "PrimaryGoal" AS ENUM ('PROFESSIONAL', 'FAMILY', 'BEAUTY');

-- CreateEnum
CREATE TYPE "FamilyProblem" AS ENUM ('BACK_NECK', 'LEGS_SWELLING_FATIGUE', 'HOME_RELAXATION');

-- CreateEnum
CREATE TYPE "BeautyProfession" AS ENUM ('NAILS', 'HAIR', 'DEPILATION', 'LASH_BROW_COSMETOLOGY');

-- CreateEnum
CREATE TYPE "BonusType" AS ENUM ('VIDEO', 'DOCUMENT', 'CHECKLIST', 'URL');

-- AlterEnum
ALTER TYPE "ExperienceLevel" ADD VALUE 'HAS_BASIC_EXPERIENCE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReminderType" ADD VALUE 'FUNNEL_INACTIVE';
ALTER TYPE "ReminderType" ADD VALUE 'BONUS_NOT_VIEWED';
ALTER TYPE "ReminderType" ADD VALUE 'COURSE_NOT_SELECTED';
ALTER TYPE "ReminderType" ADD VALUE 'PAYMENT_NOT_COMPLETED';

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'RU',
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "username" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "beautyProfession" "BeautyProfession",
ADD COLUMN     "familyProblem" "FamilyProblem",
ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'RU',
ADD COLUMN     "primaryGoal" "PrimaryGoal",
ADD COLUMN     "selectedTariffId" TEXT;

-- AlterTable
ALTER TABLE "CourseCategory" ADD COLUMN "code" TEXT;
UPDATE "CourseCategory" SET "code" = slug;
ALTER TABLE "CourseCategory" ALTER COLUMN "code" SET NOT NULL;

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "RecommendationRule" ADD COLUMN     "beautyProfession" "BeautyProfession",
ADD COLUMN     "familyProblem" "FamilyProblem",
ADD COLUMN     "primaryGoal" "PrimaryGoal";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "tariffId" TEXT;

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "tariffId" TEXT;

-- AlterTable
ALTER TABLE "FunnelEvent" ADD COLUMN     "tariffId" TEXT;

-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AdminConversationState" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "CourseCategoryTranslation" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "CourseCategoryTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseTranslation" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT,
    "fullDescription" TEXT,
    "program" TEXT,
    "duration" TEXT,

    CONSTRAINT "CourseTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseTariff" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "priceKZT" DECIMAL(12,2) NOT NULL,
    "priceRUB" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseTariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseTariffTranslation" (
    "id" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "CourseTariffTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelContent" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "text" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusMaterial" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "targetSegment" "PrimaryGoal" NOT NULL,
    "fileId" TEXT,
    "fileType" TEXT,
    "url" TEXT,
    "type" "BonusType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BonusMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusMaterialTranslation" (
    "id" TEXT NOT NULL,
    "bonusId" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "buttonText" TEXT,

    CONSTRAINT "BonusMaterialTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CourseCategoryTranslation_categoryId_language_key" ON "CourseCategoryTranslation"("categoryId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "CourseTranslation_courseId_language_key" ON "CourseTranslation"("courseId", "language");

-- CreateIndex
CREATE INDEX "CourseTariff_active_courseId_sortOrder_idx" ON "CourseTariff"("active", "courseId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CourseTariff_courseId_code_key" ON "CourseTariff"("courseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CourseTariffTranslation_tariffId_language_key" ON "CourseTariffTranslation"("tariffId", "language");

-- CreateIndex
CREATE INDEX "FunnelContent_stage_language_idx" ON "FunnelContent"("stage", "language");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelContent_key_language_key" ON "FunnelContent"("key", "language");

-- CreateIndex
CREATE UNIQUE INDEX "BonusMaterial_code_key" ON "BonusMaterial"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BonusMaterialTranslation_bonusId_language_key" ON "BonusMaterialTranslation"("bonusId", "language");

-- CreateIndex
CREATE UNIQUE INDEX "CourseCategory_code_key" ON "CourseCategory"("code");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_selectedTariffId_fkey" FOREIGN KEY ("selectedTariffId") REFERENCES "CourseTariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "CourseTariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "CourseTariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "CourseTariff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCategoryTranslation" ADD CONSTRAINT "CourseCategoryTranslation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CourseCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTranslation" ADD CONSTRAINT "CourseTranslation_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTariff" ADD CONSTRAINT "CourseTariff_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTariffTranslation" ADD CONSTRAINT "CourseTariffTranslation_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "CourseTariff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusMaterialTranslation" ADD CONSTRAINT "BonusMaterialTranslation_bonusId_fkey" FOREIGN KEY ("bonusId") REFERENCES "BonusMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill actual legacy catalog text and prices without changing payment amounts.
INSERT INTO "CourseCategoryTranslation" (id,"categoryId",language,title,description)
SELECT 'kt-' || id,id,'RU',title,description FROM "CourseCategory";
INSERT INTO "CourseTranslation" (id,"courseId",language,title,"shortDescription","fullDescription",program,duration)
SELECT 'ct-' || id,id,'RU',title,"shortDescription","fullDescription",program,duration FROM "Course";
INSERT INTO "CourseTariff" (id,"courseId",code,"priceKZT","priceRUB","updatedAt")
SELECT 't-' || id,id,'STANDARD',"priceKZT","priceRUB",CURRENT_TIMESTAMP FROM "Course";
INSERT INTO "CourseTariffTranslation" (id,"tariffId",language,title)
SELECT 'tt-' || id,'t-' || id,'RU','Стандартный' FROM "Course";
UPDATE "Payment" SET "tariffId" = 't-' || "courseId";
UPDATE "Enrollment" SET "tariffId" = 't-' || "courseId";
ALTER TABLE "Course" DROP COLUMN "priceKZT", DROP COLUMN "priceRUB";
ALTER TABLE "CourseTariff" ADD CONSTRAINT "CourseTariff_nonnegative_prices" CHECK ("priceKZT" >= 0 AND "priceRUB" >= 0);
CREATE INDEX "User_language_createdAt_idx" ON "User"(language,"createdAt");
CREATE INDEX "User_primaryGoal_idx" ON "User"("primaryGoal");
CREATE INDEX "Payment_tariffId_idx" ON "Payment"("tariffId");
CREATE INDEX "Enrollment_tariffId_idx" ON "Enrollment"("tariffId");

COMMIT;
