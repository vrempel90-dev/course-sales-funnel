import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { bootstrapOwner } from "../src/services/auth";
import { defaultSettings } from "../src/services/schemas";

const db = new PrismaClient();

type CourseSeed = {
  slug: string;
  title: string;
  category: string;
  priceKZT: number;
  priceRUB: number;
  short: string;
};

const categories = [
  ["professional", "Для новичков и массажистов", 10],
  ["home", "Для дома", 20],
  ["beauty", "Для бьюти-мастеров", 30],
  ["additional", "Дополнительные курсы", 40],
] as const;

const courses: CourseSeed[] = [
  {
    slug: "classic-body-face",
    title: "Классический массаж тела и лица",
    category: "professional",
    priceKZT: 30000,
    priceRUB: 6000,
    short: "Фундаментальная программа по классическому массажу тела и лица.",
  },
  {
    slug: "myofascial-face",
    title: "Миофасциальный массаж лица",
    category: "professional",
    priceKZT: 30000,
    priceRUB: 6000,
    short: "Практическая программа по миофасциальным техникам для лица.",
  },
  {
    slug: "baby-massage-lfk",
    title: "Грудничковый массаж + ЛФК",
    category: "professional",
    priceKZT: 30000,
    priceRUB: 6000,
    short: "Обучение массажу грудничков и базовым приёмам ЛФК.",
  },
  {
    slug: "teen-massage",
    title: "Подростковый массаж",
    category: "professional",
    priceKZT: 30000,
    priceRUB: 6000,
    short: "Курс по безопасной работе с подростками.",
  },
  {
    slug: "back-without-pain",
    title: "Спина без боли",
    category: "home",
    priceKZT: 5000,
    priceRUB: 1000,
    short: "Домашние техники для расслабления спины и шеи.",
  },
  {
    slug: "light-legs-home",
    title: "Лёгкие ножки",
    category: "home",
    priceKZT: 5000,
    priceRUB: 1000,
    short: "Домашний экспресс-курс для уставших ног.",
  },
  {
    slug: "home-massage-therapist",
    title: "Домашний массажист",
    category: "home",
    priceKZT: 10000,
    priceRUB: 2000,
    short: "Базовые безопасные техники массажа для себя и семьи.",
  },
  {
    slug: "express-hands",
    title: "Экспресс-массаж рук и кистей",
    category: "beauty",
    priceKZT: 3000,
    priceRUB: 700,
    short: "Короткая дополнительная услуга для мастеров маникюра и педикюра.",
  },
  {
    slug: "express-legs",
    title: "Экспресс-массаж ног",
    category: "beauty",
    priceKZT: 3000,
    priceRUB: 700,
    short: "Экспресс-массаж ног для специалистов по телу и депиляции.",
  },
  {
    slug: "express-neck-head",
    title: "Экспресс-массаж ШВЗ и головы",
    category: "beauty",
    priceKZT: 3000,
    priceRUB: 700,
    short: "Экспресс-техника для мастеров по волосам.",
  },
  {
    slug: "express-face",
    title: "Экспресс-массаж лица",
    category: "beauty",
    priceKZT: 3000,
    priceRUB: 700,
    short: "Экспресс-массаж лица как дополнительная бьюти-услуга.",
  },
  {
    slug: "guasha",
    title: "Массаж Гуаша",
    category: "beauty",
    priceKZT: 3000,
    priceRUB: 700,
    short: "Практический мини-курс по массажу Гуаша.",
  },
  {
    slug: "anatomy-for-massage",
    title: "Анатомия для массажистов",
    category: "additional",
    priceKZT: 5000,
    priceRUB: 1000,
    short: "Базовая анатомия, необходимая массажисту в практике.",
  },
  {
    slug: "hot-stones",
    title: "Массаж горячими камнями",
    category: "additional",
    priceKZT: 5000,
    priceRUB: 1000,
    short: "Дополнительная техника массажа горячими камнями.",
  },
  {
    slug: "vacuum-cups",
    title: "Массаж вакуумными банками",
    category: "additional",
    priceKZT: 5000,
    priceRUB: 1000,
    short: "Практический курс по работе с вакуумными банками.",
  },
];

async function ensureTariff(
  courseId: string,
  code: string,
  titleRu: string,
  titleKz: string,
  priceKZT: number,
  priceRUB: number,
  sortOrder: number,
) {
  await db.courseTariff.upsert({
    where: { courseId_code: { courseId, code } },
    update: {},
    create: {
      courseId,
      code,
      titleRu,
      titleKz,
      priceKZT,
      priceRUB,
      sortOrder,
      active: true,
    },
  });
}

async function main() {
  for (const [slug, title, sortOrder] of categories) {
    await db.courseCategory.upsert({
      where: { slug },
      update: { title, active: true, sortOrder },
      create: { slug, title, active: true, sortOrder },
    });
  }

  for (const [index, item] of courses.entries()) {
    const category = await db.courseCategory.findUniqueOrThrow({
      where: { slug: item.category },
    });
    const course = await db.course.upsert({
      where: { slug: item.slug },
      update: {
        categoryId: category.id,
        title: item.title,
        shortDescription: item.short,
        priceKZT: item.priceKZT,
        priceRUB: item.priceRUB,
        status: "ACTIVE",
        sortOrder: index,
      },
      create: {
        slug: item.slug,
        title: item.title,
        categoryId: category.id,
        shortDescription: item.short,
        fullDescription: item.short,
        program: "Программа курса уточняется в карточке курса.",
        duration: "Онлайн-обучение",
        priceKZT: item.priceKZT,
        priceRUB: item.priceRUB,
        status: "ACTIVE",
        sortOrder: index,
      },
    });

    if (item.category === "professional") {
      await ensureTariff(course.id, "SELF", "Самостоятельный", "Өз бетінше", 30000, 6000, 10);
      await ensureTariff(course.id, "CURATOR", "С куратором", "Куратормен", 50000, 10000, 20);
      await ensureTariff(course.id, "MENTORSHIP", "Наставничество", "Тәлімгерлік", 75000, 15000, 30);
    } else {
      await ensureTariff(course.id, "STANDARD", "Стандарт", "Стандарт", item.priceKZT, item.priceRUB, 10);
    }
  }

  // Old demo records from the admin-only seed must not appear in the client sales flow.
  for (const slug of ["full-body", "healthy-back", "light-legs", "face-massage", "child-massage"]) {
    await db.course.updateMany({ where: { slug }, data: { status: "ARCHIVED" } });
  }

  const paymentSettings = [
    {
      country: "KZ" as const,
      currency: "KZT" as const,
      title: "Kaspi",
      enabled: true,
      instruction: "1. Оплатите точную сумму по кнопке ниже.\n2. Вернитесь в бот и нажмите «Я оплатил(а)».\n3. Отправьте исходный фискальный чек Kaspi в формате PDF.\n4. Бот автоматически проверит сумму, получателя, дату и уникальность чека и подтвердит оплату при полном совпадении.",
      requisites: "https://pay.kaspi.kz/pay/ajkfewqw",
    },
    {
      country: "RU" as const,
      currency: "RUB" as const,
      title: "Банковский перевод",
      enabled: false,
      instruction: "",
      requisites: "",
    },
  ];

  for (const setting of paymentSettings) {
    await db.paymentMethodSetting.upsert({
      where: { country: setting.country },
      update: {
        currency: setting.currency,
        title: setting.title,
        enabled: setting.enabled,
        instruction: setting.instruction,
        requisites: setting.requisites,
      },
      create: setting,
    });
  }

  await db.setting.upsert({
    where: { key: "admin.settings" },
    update: {},
    create: {
      key: "admin.settings",
      value: { ...defaultSettings, projectName: "Massage Academy" },
    },
  });

  await db.setting.upsert({
    where: { key: "client.bonus.professional" },
    update: {},
    create: { key: "client.bonus.professional", value: { fileId: null, url: null } },
  });
  await db.setting.upsert({
    where: { key: "client.bonus.family" },
    update: {},
    create: { key: "client.bonus.family", value: { fileId: null, url: null } },
  });
  await db.setting.upsert({
    where: { key: "client.bonus.beauty" },
    update: {},
    create: { key: "client.bonus.beauty", value: { fileId: null, url: null } },
  });

  await bootstrapOwner(db, process.env.OWNER_TELEGRAM_ID || undefined);
  console.info("Seed complete: real Massage Academy catalog and tariffs are ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
