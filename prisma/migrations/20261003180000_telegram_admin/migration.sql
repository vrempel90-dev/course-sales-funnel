ALTER TYPE "Role" ADD VALUE 'OWNER';
ALTER TYPE "AccessStatus" RENAME VALUE 'WAITING' TO 'PENDING';
ALTER TABLE "AdminUser" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "CourseCategory" ADD COLUMN "description" TEXT;
ALTER TABLE "Course" ADD COLUMN "imageFileId" TEXT, ADD COLUMN "imageFileType" TEXT, ADD COLUMN "demoFileType" TEXT, ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TelegramBotError" ADD COLUMN "errorType" TEXT NOT NULL DEFAULT 'UNKNOWN', ADD COLUMN "stack" TEXT, ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "TelegramBotError" ALTER COLUMN "context" TYPE JSONB USING jsonb_build_object('legacyContext', "context");
CREATE TABLE "AdminConversationState" (
 "id" TEXT PRIMARY KEY, "adminId" TEXT NOT NULL UNIQUE REFERENCES "AdminUser"("id") ON DELETE CASCADE,
 "flowType" TEXT NOT NULL, "step" INTEGER NOT NULL DEFAULT 0, "nonce" TEXT NOT NULL UNIQUE,
 "payload" JSONB NOT NULL DEFAULT '{}', "expiresAt" TIMESTAMP(3) NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PaymentMethodSetting" (
 "id" TEXT PRIMARY KEY, "country" "Country" NOT NULL UNIQUE, "currency" "Currency" NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT false, "title" TEXT NOT NULL, "instruction" TEXT NOT NULL DEFAULT '',
 "requisites" TEXT NOT NULL DEFAULT '', "updatedAt" TIMESTAMP(3) NOT NULL, "updatedBy" TEXT
);
INSERT INTO "PaymentMethodSetting" ("id","country","currency","enabled","title","instruction","requisites","updatedAt")
SELECT 'migrated-' || s."key", split_part(s."key",'.',2)::"Country",
 CASE WHEN s."key"='payment.KZ' THEN 'KZT'::"Currency" ELSE 'RUB'::"Currency" END,
 COALESCE((s."value"->>'enabled')::boolean,false), COALESCE(s."value"->>'title',''),
 COALESCE(s."value"->>'instruction',''), COALESCE(s."value"->>'requisites',''), CURRENT_TIMESTAMP
FROM "Setting" s WHERE s."key" IN ('payment.KZ','payment.RU');
