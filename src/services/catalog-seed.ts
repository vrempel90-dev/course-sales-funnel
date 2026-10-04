import {
  PrismaClient,
  PrimaryGoal,
  FamilyProblem,
  BeautyProfession,
} from "@prisma/client";

export const catalog = [
  [
    "classical-body-face",
    "Классический массаж тела и лица",
    "PROFESSIONAL",
    30000,
    6000,
  ],
  [
    "myofascial-face",
    "Миофасциальный массаж лица",
    "PROFESSIONAL",
    30000,
    6000,
  ],
  [
    "infant-massage-lfk",
    "Грудничковый массаж + ЛФК",
    "PROFESSIONAL",
    30000,
    6000,
  ],
  ["teen-massage", "Подростковый массаж", "PROFESSIONAL", 30000, 6000],
  ["pain-free-back", "Спина без боли", "HOME", 5000, 1000],
  ["home-light-legs", "Лёгкие ножки", "HOME", 5000, 1000],
  ["home-masseur", "Домашний массажист", "HOME", 10000, 2000],
  ["express-hands", "Экспресс-массаж рук и кистей", "BEAUTY", 3000, 700],
  ["express-legs", "Экспресс-массаж ног", "BEAUTY", 3000, 700],
  ["express-neck-head", "Экспресс-массаж ШВЗ и головы", "BEAUTY", 3000, 700],
  ["express-face", "Экспресс-массаж лица", "BEAUTY", 3000, 700],
  ["gua-sha", "Массаж Гуаша", "BEAUTY", 3000, 700],
  ["anatomy", "Анатомия для массажистов", "ADDITIONAL", 5000, 1000],
  ["hot-stones", "Массаж горячими камнями", "ADDITIONAL", 5000, 1000],
  ["vacuum-cups", "Массаж вакуумными банками", "ADDITIONAL", 5000, 1000],
] as const;

export const funnelSeed = [
  [
    "WELCOME",
    "WELCOME",
    "Здравствуйте! 👋 Приветствую вас!\nМассаж — это универсальный инструмент: он может стать вашей новой высокооплачиваемой профессией, способом заботы о близких или услугой, которая удвоит ваш чек в бьюти-сфере.\nЧтобы я подобрал(а) для вас самую полезную информацию и бонусы, подскажите: с какой целью вы хотите освоить массажные техники?",
  ],
  ["GOAL_PROFESSIONAL", "WELCOME", "🔴 Освоить профессию массажиста с нуля"],
  ["GOAL_FAMILY", "WELCOME", "🟢 Массаж для себя и семьи"],
  ["GOAL_BEAUTY", "WELCOME", "🔵 Я бьюти-мастер / Увеличить чек"],
  [
    "PROFESSIONAL_QUESTION",
    "PROFESSIONAL",
    "Отличный выбор! Профессия массажиста дает свободу, независимый график и стабильный доход без привязки к начальству.\n\nСкажите, опыт в массаже у вас уже есть или начинаете с самого нуля?",
  ],
  ["EXPERIENCE_BEGINNER", "PROFESSIONAL", "Я полный новичок, опыта нет"],
  [
    "EXPERIENCE_BASIC",
    "PROFESSIONAL",
    "Проходил(а) базовые курсы / делаю любительски",
  ],
  [
    "PROFESSIONAL_BONUS",
    "PROFESSIONAL",
    'Понимаю! Главный страх новичка — "вдруг у меня не получится постановка рук" или "где брать клиентов".\n\nНаш фундаментальный курс построен так, что вы шаг за шагом освоите анатомию, технику классического и миофасциального массажа, а также получите пошаговый план по поиску первых клиентов.\n\n🎁 Заберите видеоурок: "3 базовых приема массажа, с которых начинает любой профи"',
  ],
  [
    "PROFESSIONAL_CTA",
    "PROFESSIONAL",
    "🎬 Смотреть видеоурок + Посмотреть программы и тарифы",
  ],
  [
    "FAMILY_QUESTION",
    "FAMILY",
    "Прекрасная цель! Умение снять боль в спине у мужа/жены после рабочего дня или расслабить близких — это лучшая забота без лекарств.\n\nКакая проблема сейчас актуальнее всего?",
  ],
  ["FAMILY_BACK_NECK", "FAMILY", "Боли и зажимы в спине / шее у близких"],
  ["FAMILY_LEGS", "FAMILY", "Отеки, усталость ног, бессонница"],
  [
    "FAMILY_RELAX",
    "FAMILY",
    "Хочу научиться безопасному расслабляющему массажу для дома",
  ],
  [
    "FAMILY_BONUS",
    "FAMILY",
    'Для домашнего применения вам не нужно учить сложную медицину годами. Достаточно освоить базовые, безопасные движения, которые сразу дают облегчение.\n\nСпециально для этого мы создали легкие экспресс-курсы: «Спина без боли», «Лёгкие ножки» и «Домашний массажист».\n\n🎁 Заберите чек-лист: "5 правил безопасного домашнего массажа, чтобы не навредить"',
  ],
  [
    "FAMILY_CTA",
    "FAMILY",
    "📖 Скачать чек-лист + Узнать стоимость мини-курсов",
  ],
  [
    "BEAUTY_QUESTION",
    "BEAUTY",
    "Супер! Добавление экспресс-массажа к основной услуге — это самый быстрый способ поднять чек на +20–40% без привлечения новых клиентов!\n\nВ какой сфере бьюти вы работаете?",
  ],
  ["BEAUTY_NAILS_OPTION", "BEAUTY", "💅 Мастер маникюра / педикюра"],
  [
    "BEAUTY_HAIR_OPTION",
    "BEAUTY",
    "💆‍♀️ Мастер по волосам / Парикмахер / Колорист",
  ],
  [
    "BEAUTY_DEPILATION_OPTION",
    "BEAUTY",
    "🍯 Мастер депиляции / Эпиляции / Спец по телу",
  ],
  ["BEAUTY_LASH_OPTION", "BEAUTY", "👁️ Лэшмейкер / Бровист / Косметолог"],
  [
    "BEAUTY_NAILS",
    "BEAUTY",
    "Клиентки обожают заботу! Добавив 10-минутный Массаж рук и кистей в конце процедуры, вы легко продаете его как VIP-уход или повышаете прайс на маникюр.",
  ],
  [
    "BEAUTY_HAIR",
    "BEAUTY",
    "Пока выдерживается краска, маска или состав для кератина, вы можете предложить Экспресс-массаж головы и ШВЗ. Это превращает обычный поход в салон в настоящую СПА-процедуру!",
  ],
  [
    "BEAUTY_DEPILATION",
    "BEAUTY",
    "После процедуры шугаринга/воска идеальное дополнение — Лимфодренажный экспресс-массаж ног («Лёгкие ножки»). Это снимает отечность, улучшает микроциркуляцию и оставляет потрясающее впечатление у клиента.",
  ],
  [
    "BEAUTY_LASH",
    "BEAUTY",
    "Добавьте Массаж ШВЗ или легкий массаж лица Гуаша, пока клиент отдыхает. Это уникальная фишка, которая выделит вас среди конкурентов!",
  ],
  ["BEAUTY_CTA", "BEAUTY", "🚀 Смотреть спец-предложение для бьюти-мастеров"],
  [
    "BEAUTY_BONUS",
    "BEAUTY",
    "Как упаковать доп. услугу и продавать её каждому второму клиенту",
  ],
  ["SALE", "SALE", ""],
  ["REMINDER_FUNNEL", "REMINDERS", ""],
  ["REMINDER_BONUS", "REMINDERS", ""],
  ["REMINDER_PAYMENT", "REMINDERS", ""],
] as const;

export async function seedCatalog(db: PrismaClient) {
  await db.$transaction(
    async (tx) => {
      const categories = new Map<string, string>();
      for (const [sortOrder, [code, title]] of [
        ["PROFESSIONAL", "Профессиональные курсы"],
        ["HOME", "Для себя и семьи"],
        ["BEAUTY", "Для бьюти-мастеров"],
        ["ADDITIONAL", "Дополнительные курсы"],
      ].entries()) {
        const c = await tx.courseCategory.upsert({
          where: { code },
          update: {},
          create: { code, slug: code.toLowerCase(), title, sortOrder },
        });
        categories.set(code, c.id);
        for (const language of ["RU", "KZ"] as const)
          await tx.courseCategoryTranslation.upsert({
            where: { categoryId_language: { categoryId: c.id, language } },
            update: {},
            create: {
              categoryId: c.id,
              language,
              title: language === "RU" ? title : "",
            },
          });
      }
      const courses = new Map<string, string>();
      for (const [
        sortOrder,
        [slug, title, category, priceKZT, priceRUB],
      ] of catalog.entries()) {
        const c = await tx.course.upsert({
          where: { slug },
          update: {},
          create: {
            slug,
            title,
            categoryId: categories.get(category)!,
            shortDescription: "",
            fullDescription: "",
            program: "",
            duration: "",
            status: "DRAFT",
            sortOrder,
          },
        });
        courses.set(slug, c.id);
        for (const language of ["RU", "KZ"] as const)
          await tx.courseTranslation.upsert({
            where: { courseId_language: { courseId: c.id, language } },
            update: {},
            create: {
              courseId: c.id,
              language,
              title: language === "RU" ? title : "",
            },
          });
        const tariffs =
          category === "PROFESSIONAL"
            ? ([
                ["SELF", "Самостоятельный", 30000, 6000],
                ["CURATOR", "С куратором", 50000, 10000],
                ["MENTORSHIP", "Наставничество", 75000, 15000],
              ] as const)
            : ([["STANDARD", "Стандартный", priceKZT, priceRUB]] as const);
        for (const [
          sortOrder,
          [code, tariffTitle, priceKZT, priceRUB],
        ] of tariffs.entries()) {
          const tariff = await tx.courseTariff.upsert({
            where: { courseId_code: { courseId: c.id, code } },
            update: {},
            create: { courseId: c.id, code, priceKZT, priceRUB, sortOrder },
          });
          for (const language of ["RU", "KZ"] as const)
            await tx.courseTariffTranslation.upsert({
              where: { tariffId_language: { tariffId: tariff.id, language } },
              update: {},
              create: {
                tariffId: tariff.id,
                language,
                title: language === "RU" ? tariffTitle : "",
              },
            });
        }
      }
      const rules: {
        id: string;
        slug: string;
        primaryGoal: PrimaryGoal;
        experienceLevel?: "BEGINNER" | "HAS_BASIC_EXPERIENCE";
        familyProblem?: FamilyProblem;
        beautyProfession?: BeautyProfession;
      }[] = [];
      for (const [slug, , ,] of catalog.filter((c) => c[2] === "PROFESSIONAL"))
        for (const experienceLevel of [
          "BEGINNER",
          "HAS_BASIC_EXPERIENCE",
        ] as const)
          rules.push({
            id:
              "seed-" +
              slug +
              "-" +
              (experienceLevel === "BEGINNER" ? "new" : "basic"),
            slug,
            primaryGoal: "PROFESSIONAL",
            experienceLevel,
          });
      for (const [slug, familyProblem] of [
        ["pain-free-back", "BACK_NECK"],
        ["home-light-legs", "LEGS_SWELLING_FATIGUE"],
        ["home-masseur", "HOME_RELAXATION"],
      ] as const)
        rules.push({
          id: "seed-" + slug,
          slug,
          primaryGoal: "FAMILY",
          familyProblem,
        });
      for (const [slug, beautyProfession] of [
        ["express-hands", "NAILS"],
        ["express-neck-head", "HAIR"],
        ["express-legs", "DEPILATION"],
        ["express-neck-head", "LASH_BROW_COSMETOLOGY"],
        ["gua-sha", "LASH_BROW_COSMETOLOGY"],
      ] as const)
        rules.push({
          id: "seed-" + slug + "-" + beautyProfession.toLowerCase().slice(0, 5),
          slug,
          primaryGoal: "BEAUTY",
          beautyProfession,
        });
      for (const { id, slug, ...conditions } of rules)
        await tx.recommendationRule.upsert({
          where: { id },
          update: {},
          create: {
            id,
            courseId: courses.get(slug)!,
            ...conditions,
            priority: 10,
          },
        });
      for (const [key, stage, text] of funnelSeed)
        for (const language of ["RU", "KZ"] as const)
          await tx.funnelContent.upsert({
            where: { key_language: { key, language } },
            update: {},
            create: {
              key,
              stage,
              language,
              text: language === "RU" ? text : "",
              active: !!text,
            },
          });
      for (const [code, targetSegment, type, title, buttonText] of [
        [
          "PROFESSIONAL_BASIC_VIDEO",
          "PROFESSIONAL",
          "VIDEO",
          "3 базовых приема массажа, с которых начинает любой профи",
          "🎬 Смотреть видеоурок + Посмотреть программы и тарифы",
        ],
        [
          "FAMILY_SAFE_CHECKLIST",
          "FAMILY",
          "CHECKLIST",
          "5 правил безопасного домашнего массажа, чтобы не навредить",
          "📖 Скачать чек-лист + Узнать стоимость мини-курсов",
        ],
        [
          "BEAUTY_SALES_VIDEO",
          "BEAUTY",
          "VIDEO",
          "Как упаковать доп. услугу и продавать её каждому второму клиенту",
          "🚀 Смотреть спец-предложение для бьюти-мастеров",
        ],
      ] as const) {
        const b = await tx.bonusMaterial.upsert({
          where: { code },
          update: {},
          create: { code, targetSegment, type },
        });
        for (const language of ["RU", "KZ"] as const)
          await tx.bonusMaterialTranslation.upsert({
            where: { bonusId_language: { bonusId: b.id, language } },
            update: {},
            create: {
              bonusId: b.id,
              language,
              title: language === "RU" ? title : "",
              buttonText: language === "RU" ? buttonText : null,
            },
          });
      }
    },
    { timeout: 30000 },
  );
}
