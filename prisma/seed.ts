import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { bootstrapOwner } from "../src/services/auth";
import { defaultSettings } from "../src/services/schemas";
import { seedCatalog } from "../src/services/catalog-seed";
const db = new PrismaClient();
async function main() {
  await seedCatalog(db);
  for (const [country, currency, title] of [
    ["KZ", "KZT", "Kaspi"],
    ["RU", "RUB", "Банковский перевод"],
  ] as const)
    await db.paymentMethodSetting.upsert({
      where: { country },
      update: {},
      create: { country, currency, title, enabled: false },
    });
  await db.setting.upsert({
    where: { key: "admin.settings" },
    update: {},
    create: { key: "admin.settings", value: defaultSettings },
  });
  await bootstrapOwner(db, process.env.OWNER_TELEGRAM_ID || undefined);
  console.info(
    "Seed complete: existing records preserved; 15 real courses, 23 tariffs, RU/KZ content; new courses are DRAFT.",
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
