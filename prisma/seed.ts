import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
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
    const course = await db.course.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        title,
        categoryId: category.id,
        shortDescription:
          "Пример программы. Замените описание перед публикацией.",
        fullDescription:
          "Демонстрационные данные для настройки каталога. Добавьте реальные описание, программу, демоурок, цены и Telegram-канал.",
        program: "Теория\nПрактика\nРазбор вопросов",
        duration: "4 недели (пример)",
        priceKZT,
        priceRUB,
        status: "DRAFT",
      },
    });
    if (
      !(await db.recommendationRule.findFirst({
        where: { courseId: course.id },
      }))
    )
      await db.recommendationRule.create({
        data: {
          courseId: course.id,
          categoryId: category.id,
          experienceLevel: slug === "full-body" ? "BEGINNER" : null,
          priority: 10,
          matchMode: "ALL",
        },
      });
  }
  const settings = {
    "payment.KZ": {
      enabled: false,
      title: "Kaspi",
      instruction: "",
      requisites: "",
    },
    "payment.RU": {
      enabled: false,
      title: "Банковский перевод",
      instruction: "",
      requisites: "",
    },
    reminders: { enabled: false, demoHours: 24, paymentHours: 12 },
    bot: {
      adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID ?? "",
      helpText:
        "Для помощи нажмите «Задать вопрос». Оплату проверяет администратор вручную.",
    },
  };
  for (const [key, value] of Object.entries(settings))
    await db.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  const email = process.env.ADMIN_INITIAL_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password) {
    console.info(
      "Seed data created. Set ADMIN_INITIAL_EMAIL/PASSWORD and rerun to create the first admin.",
    );
    return;
  }
  if (password.length < 12)
    throw new Error("ADMIN_INITIAL_PASSWORD must be at least 12 characters");
  if (!(await db.adminUser.findUnique({ where: { email } }))) {
    const admin = await db.adminUser.create({
      data: {
        name: process.env.ADMIN_INITIAL_NAME || "Administrator",
        email,
        passwordHash: await hashPassword(password),
        role: "ADMIN",
        telegramId: process.env.ADMIN_INITIAL_TELEGRAM_ID
          ? BigInt(process.env.ADMIN_INITIAL_TELEGRAM_ID)
          : null,
      },
    });
    await db.auditLog.create({
      data: {
        adminId: admin.id,
        action: "ADMIN_CREATED",
        entity: "AdminUser",
        entityId: admin.id,
      },
    });
    console.info(
      "Initial admin created. Existing passwords are never reset by seed.",
    );
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
