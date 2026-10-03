import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { bootstrapOwner } from "../src/services/auth";
import { defaultSettings } from "../src/services/schemas";
const db = new PrismaClient();
async function main() {
  const categories = [
    ["body", "Массаж тела"],
    ["face", "Массаж лица"],
    ["children", "Детский массаж"],
    ["back", "Работа со спиной"],
    ["legs", "Работа с ногами"],
  ];
  for (const [sortOrder, [slug, title]] of categories.entries())
    await db.courseCategory.upsert({
      where: { slug },
      update: {},
      create: { slug, title, sortOrder },
    });
  const courses = [
    ["full-body", "Полный курс массажа тела", "body", 150000, 30000],
    ["healthy-back", "Здоровая спина", "back", 50000, 10000],
    ["light-legs", "Лёгкие ножки", "legs", 40000, 8000],
    ["face-massage", "Массаж лица", "face", 60000, 12000],
    ["child-massage", "Детский массаж", "children", 80000, 16000],
  ] as const;
  for (const [slug, title, categorySlug, priceKZT, priceRUB] of courses) {
    const category = await db.courseCategory.findUniqueOrThrow({
      where: { slug: categorySlug },
    });
    await db.course.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        title,
        categoryId: category.id,
        shortDescription: "Пример программы. Замените перед активацией.",
        fullDescription:
          "Демонстрационные данные. Укажите реальные описание, программу, демоурок, цены и Telegram-канал.",
        program: "Теория\nПрактика\nВопросы",
        duration: "4 недели (пример)",
        priceKZT,
        priceRUB,
        status: "DRAFT",
      },
    });
  }
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
    "Seed complete: existing records preserved; sample courses are DRAFT.",
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
