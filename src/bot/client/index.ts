import {
  BeautyProfession,
  Country,
  FamilyProblem,
  Language,
  PrimaryGoal,
  Prisma,
  PrismaClient,
  User,
} from "@prisma/client";
import { Context, InlineKeyboard } from "grammy";
import { createHash } from "node:crypto";
import { AppError, safeError } from "../../lib/errors";
import { verifyKaspiReceiptPdf } from "../../services/kaspi_receipt_verifier";
import { PaymentService } from "../../services/payments";
import { AccessService } from "../../services/access";
import { GrammyGateway } from "../gateway";
import { courseTitleKz, tr } from "./i18n";

const money = (value: Prisma.Decimal | number | string) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(value));

function title(language: Language | null, course: { slug: string; title: string }) {
  return language === "KZ" ? courseTitleKz[course.slug] ?? course.title : course.title;
}

function langKeyboard() {
  return new InlineKeyboard()
    .text("🇷🇺 Русский", "c:lang:RU")
    .text("🇰🇿 Қазақша", "c:lang:KZ");
}

function menuKeyboard(language: Language | null) {
  const t = tr(language);
  return new InlineKeyboard()
    .text(t.chooseTraining, "c:welcome")
    .row()
    .text(t.myCourses, "c:my")
    .row()
    .text(t.ask, "c:ask:none")
    .row()
    .text(t.language, "c:language");
}

function backMenu(language: Language | null) {
  return new InlineKeyboard().text(tr(language).mainMenu, "c:menu");
}

export class ClientBot {
  constructor(public db: PrismaClient) {}

  async ensureUser(ctx: Context) {
    if (!ctx.from || ctx.chat?.type !== "private")
      throw new AppError("Команда доступна только в личном чате");
    const data = {
      telegramUsername: ctx.from.username ?? null,
      firstName: ctx.from.first_name || "User",
      lastName: ctx.from.last_name ?? null,
      lastActivityAt: new Date(),
    };
    const existing = await this.db.user.findUnique({
      where: { telegramId: BigInt(ctx.from.id) },
    });
    if (existing)
      return this.db.user.update({ where: { id: existing.id }, data });
    const created = await this.db.user.create({
      data: {
        telegramId: BigInt(ctx.from.id),
        ...data,
        currentFunnelStage: "TELEGRAM_STARTED",
        conversationStep: "LANGUAGE",
      },
    });
    await this.event(created.id, "TELEGRAM_STARTED");
    return created;
  }

  async event(
    userId: string,
    type: string,
    courseId?: string | null,
    tariffId?: string | null,
    metadata: Prisma.InputJsonValue = {},
  ) {
    await this.db.funnelEvent.create({
      data: {
        userId,
        type,
        courseId: courseId || null,
        tariffId: tariffId || null,
        metadata,
      },
    });
  }

  async start(ctx: Context) {
    const user = await this.ensureUser(ctx);
    if (!user.language) {
      await this.db.user.update({
        where: { id: user.id },
        data: { conversationStep: "LANGUAGE" },
      });
      await ctx.reply(tr(null).chooseLanguage, { reply_markup: langKeyboard() });
      return;
    }
    await this.showMenu(ctx, user);
  }

  async showMenu(ctx: Context, user: User) {
    const t = tr(user.language);
    await ctx.reply(t.mainMenu, { reply_markup: menuKeyboard(user.language) });
  }

  async welcome(ctx: Context, user: User) {
    const t = tr(user.language);
    await this.db.user.update({
      where: { id: user.id },
      data: {
        conversationStep: "PRIMARY_GOAL",
        currentFunnelStage: "QUESTIONNAIRE_STARTED",
      },
    });
    const k = new InlineKeyboard()
      .text(t.goalProfessional, "c:goal:PROFESSIONAL")
      .row()
      .text(t.goalFamily, "c:goal:FAMILY")
      .row()
      .text(t.goalBeauty, "c:goal:BEAUTY")
      .row()
      .text(t.mainMenu, "c:menu");
    await ctx.reply(t.welcome, { reply_markup: k });
  }

  async professional(ctx: Context, user: User) {
    const t = tr(user.language);
    await this.db.user.update({
      where: { id: user.id },
      data: {
        primaryGoal: "PROFESSIONAL",
        familyProblem: null,
        beautyProfession: null,
        conversationStep: "PROFESSIONAL_EXPERIENCE",
      },
    });
    await this.event(user.id, "PRIMARY_GOAL_SELECTED", null, null, {
      goal: "PROFESSIONAL",
    });
    const k = new InlineKeyboard()
      .text(t.beginner, "c:exp:BEGINNER")
      .row()
      .text(t.basicExperience, "c:exp:PRACTICING")
      .row()
      .text(t.back, "c:welcome");
    await ctx.reply(t.professionalQuestion, { reply_markup: k });
  }

  async family(ctx: Context, user: User) {
    const t = tr(user.language);
    await this.db.user.update({
      where: { id: user.id },
      data: {
        primaryGoal: "FAMILY",
        experienceLevel: null,
        familyProblem: null,
        beautyProfession: null,
        conversationStep: "IDLE",
        currentFunnelStage: "QUESTIONNAIRE_COMPLETED",
      },
    });
    await this.event(user.id, "PRIMARY_GOAL_SELECTED", null, null, {
      goal: "FAMILY",
    });
    await ctx.reply(t.familyBenefit, {
      reply_markup: new InlineKeyboard()
        .text(t.familyBonus, "c:bonus:family")
        .row()
        .text(t.back, "c:welcome"),
    });
  }

  async beauty(ctx: Context, user: User) {
    const t = tr(user.language);
    await this.db.user.update({
      where: { id: user.id },
      data: {
        primaryGoal: "BEAUTY",
        experienceLevel: null,
        familyProblem: null,
        conversationStep: "BEAUTY_PROFESSION",
      },
    });
    await this.event(user.id, "PRIMARY_GOAL_SELECTED", null, null, {
      goal: "BEAUTY",
    });
    const k = new InlineKeyboard()
      .text(t.nails, "c:beauty:NAILS")
      .row()
      .text(t.hair, "c:beauty:HAIR")
      .row()
      .text(t.depilation, "c:beauty:DEPILATION")
      .row()
      .text(t.lashes, "c:beauty:LASH_BROW_COSMETOLOGY")
      .row()
      .text(t.back, "c:welcome");
    await ctx.reply(t.beautyQuestion, { reply_markup: k });
  }

  async sendBonus(ctx: Context, user: User, kind: "professional" | "family" | "beauty") {
    const t = tr(user.language);
    const setting = await this.db.setting.findUnique({
      where: { key: "client.bonus." + kind },
    });
    const value = (setting?.value ?? {}) as Record<string, unknown>;
    const fileId = typeof value.fileId === "string" ? value.fileId : "";
    const url = typeof value.url === "string" ? value.url : "";
    try {
      if (fileId && kind === "family") await ctx.replyWithDocument(fileId);
      else if (fileId) await ctx.replyWithVideo(fileId);
      else if (url)
        await ctx.reply(url, {
          reply_markup: new InlineKeyboard().url(
            user.language === "KZ" ? "Ашу" : "Открыть",
            url,
          ),
        });
      else await ctx.reply(t.bonusMissing);
    } catch {
      await ctx.reply(t.bonusMissing);
    }
    await this.event(user.id, "BONUS_VIEWED", null, null, { kind });
  }

  async listCourses(
    ctx: Context,
    user: User,
    categorySlug: string,
    onlySlugs?: string[],
  ) {
    const t = tr(user.language);
    const category = await this.db.courseCategory.findUnique({
      where: { slug: categorySlug },
    });
    if (!category) throw new AppError("Категория не настроена");
    const rows = await this.db.course.findMany({
      where: {
        categoryId: category.id,
        status: "ACTIVE",
        ...(onlySlugs?.length ? { slug: { in: onlySlugs } } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      include: { tariffs: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
    });
    if (!rows.length) {
      await ctx.reply(user.language === "KZ" ? "Бағдарламалар әзірге қолжетімсіз." : "Программы пока недоступны.", {
        reply_markup: backMenu(user.language),
      });
      return;
    }
    await this.event(user.id, "COURSES_SHOWN", null, null, { category: categorySlug });
    const k = new InlineKeyboard();
    for (const course of rows) {
      k.text(
        title(user.language, course),
        "c:course:" + course.id,
      ).row();
    }
    k.text(t.mainMenu, "c:menu");
    await ctx.reply(t.coursesTitle, { reply_markup: k });
  }

  async showCourse(ctx: Context, user: User, courseId: string) {
    const t = tr(user.language);
    const course = await this.db.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        category: true,
        tariffs: { where: { active: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    if (course.status !== "ACTIVE") throw new AppError("Курс недоступен");
    await this.event(user.id, "COURSE_OPENED", course.id);
    const prices = course.tariffs.length
      ? course.tariffs
          .map(
            (x) =>
              (user.language === "KZ" ? x.titleKz || x.titleRu : x.titleRu) +
              ": " +
              money(x.priceKZT) +
              " ₸ / " +
              money(x.priceRUB) +
              " ₽",
          )
          .join("\n")
      : money(course.priceKZT) + " ₸ / " + money(course.priceRUB) + " ₽";
    const description =
      user.language === "KZ"
        ? "Онлайн оқу бағдарламасы. Толық бағдарлама мен материалдарды әкімші курс карточкасында жаңарта алады."
        : course.fullDescription;
    const text =
      "📚 " +
      title(user.language, course) +
      "\n\n" +
      description +
      "\n\n💰 " +
      prices;
    const k = new InlineKeyboard()
      .text(t.buy, course.tariffs.length > 1 ? "c:tariffs:" + course.id : "c:buy:" + course.id)
      .row()
      .text(t.ask, "c:ask:" + course.id)
      .row()
      .text(t.trial, "c:trial:" + course.id)
      .row()
      .text(t.back, "c:segment:" + course.category.slug);
    await ctx.reply(text, { reply_markup: k });
  }

  async showTariffs(ctx: Context, user: User, courseId: string) {
    const t = tr(user.language);
    const tariffs = await this.db.courseTariff.findMany({
      where: { courseId, active: true },
      orderBy: { sortOrder: "asc" },
    });
    if (!tariffs.length) throw new AppError("Тарифы не настроены");
    const k = new InlineKeyboard();
    for (const tariff of tariffs) {
      const name =
        user.language === "KZ" ? tariff.titleKz || tariff.titleRu : tariff.titleRu;
      k.text(
        name + " · " + money(tariff.priceKZT) + " ₸ / " + money(tariff.priceRUB) + " ₽",
        "c:tariff:" + tariff.id,
      ).row();
    }
    k.text(t.back, "c:course:" + courseId);
    await ctx.reply(t.tariffsTitle, { reply_markup: k });
  }

  async selectTariff(ctx: Context, user: User, tariffId: string) {
    const tariff = await this.db.courseTariff.findUniqueOrThrow({
      where: { id: tariffId },
      include: { course: true },
    });
    if (!tariff.active || tariff.course.status !== "ACTIVE")
      throw new AppError("Тариф недоступен");
    await this.db.user.update({
      where: { id: user.id },
      data: {
        selectedCourseId: tariff.courseId,
        selectedTariffId: tariff.id,
        conversationStep: "COUNTRY",
        currentFunnelStage: "COURSE_SELECTED",
      },
    });
    await this.event(user.id, "TARIFF_SELECTED", tariff.courseId, tariff.id, {
      code: tariff.code,
    });
    const t = tr(user.language);
    await ctx.reply(t.countryTitle, {
      reply_markup: new InlineKeyboard()
        .text(t.kz, "c:country:KZ")
        .text(t.ruCountry, "c:country:RU")
        .row()
        .text(t.back, "c:course:" + tariff.courseId),
    });
  }

  async buySingle(ctx: Context, user: User, courseId: string) {
    const tariff = await this.db.courseTariff.findFirst({
      where: { courseId, active: true },
      orderBy: { sortOrder: "asc" },
    });
    if (!tariff) throw new AppError("Тариф не настроен");
    await this.selectTariff(ctx, user, tariff.id);
  }

  async checkout(ctx: Context, user: User, country: Country) {
    const current = await this.db.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        selectedCourse: true,
        selectedTariff: true,
      },
    });
    if (!current.selectedCourse || !current.selectedTariff)
      throw new AppError("Сначала выберите курс и тариф");
    const setting = await this.db.paymentMethodSetting.findUnique({
      where: { country },
    });
    const t = tr(user.language);
    if (!setting?.enabled || !setting.instruction.trim() || !setting.requisites.trim()) {
      await ctx.reply(t.paymentNotConfigured, {
        reply_markup: new InlineKeyboard()
          .text(t.ask, "c:ask:" + current.selectedCourse.id)
          .row()
          .text(t.mainMenu, "c:menu"),
      });
      return;
    }
    const currency = country === "KZ" ? "KZT" : "RUB";
    const amount =
      country === "KZ"
        ? current.selectedTariff.priceKZT
        : current.selectedTariff.priceRUB;
    const isKaspiCheckout =
      country === "KZ" &&
      setting.requisites.startsWith("https://pay.kaspi.kz/");
    const kaspiInstruction =
      user.language === "KZ"
        ? "1. Төмендегі батырма арқылы нақты соманы төлеңіз.\n2. Ботқа оралып, «Төледім» батырмасын басыңыз.\n3. Kaspi-дің түпнұсқа фискалдық PDF-чегін жіберіңіз — бот оны автоматты түрде тексереді."
        : "1. Оплатите точную сумму по кнопке ниже.\n2. Вернитесь в бот и нажмите «Я оплатил(а)».\n3. Отправьте исходный фискальный чек Kaspi в формате PDF — бот проверит его автоматически.";
    const effectiveInstruction = isKaspiCheckout
      ? kaspiInstruction
      : setting.instruction;
    const activeKey = [user.id, current.selectedTariff.id, country].join(":");
    let payment = await this.db.payment.findUnique({ where: { activeKey } });
    if (!payment) {
      payment = await this.db.payment.create({
        data: {
          userId: user.id,
          courseId: current.selectedCourse.id,
          tariffId: current.selectedTariff.id,
          amount,
          currency,
          country,
          paymentMethod: setting.title,
          instruction: effectiveInstruction,
          requisites: setting.requisites,
          activeKey,
          status: "PENDING",
        },
      });
    }
    await this.db.user.update({
      where: { id: user.id },
      data: {
        activePaymentId: payment.id,
        currentFunnelStage: "WAITING_PAYMENT",
        conversationStep: "IDLE",
      },
    });
    await this.event(
      user.id,
      "CHECKOUT_STARTED",
      current.selectedCourse.id,
      current.selectedTariff.id,
      { paymentId: payment.id, country, currency },
    );
    const tariffName =
      user.language === "KZ"
        ? current.selectedTariff.titleKz || current.selectedTariff.titleRu
        : current.selectedTariff.titleRu;
    const text =
      "💳 " +
      title(user.language, current.selectedCourse) +
      "\n" +
      tariffName +
      "\n\n" +
      money(amount) +
      " " +
      (currency === "KZT" ? "₸" : "₽") +
      "\n\n" +
      effectiveInstruction +
      (isKaspiCheckout ? "" : "\n\n" + setting.requisites);
    const paymentKeyboard = new InlineKeyboard();
    if (isKaspiCheckout) {
      paymentKeyboard
        .url(
          user.language === "KZ"
            ? "💳 " + money(amount) + " ₸ Kaspi арқылы төлеу"
            : "💳 Оплатить " + money(amount) + " ₸ через Kaspi",
          setting.requisites,
        )
        .row();
    }
    paymentKeyboard
      .text(t.paid, "c:paid:" + payment.id)
      .row()
      .text(t.ask, "c:ask:" + current.selectedCourse.id)
      .row()
      .text(t.mainMenu, "c:menu");

    await ctx.reply(text, {
      reply_markup: paymentKeyboard,
    });
  }

  async ask(ctx: Context, user: User, courseId?: string) {
    const t = tr(user.language);
    await this.db.user.update({
      where: { id: user.id },
      data: {
        conversationStep: "MANAGER_MESSAGE",
        ...(courseId ? { selectedCourseId: courseId } : {}),
      },
    });
    await ctx.reply(t.questionPrompt, { reply_markup: backMenu(user.language) });
  }

  async trial(ctx: Context, user: User, courseId: string) {
    const t = tr(user.language);
    const request = await this.db.managerRequest.create({
      data: {
        userId: user.id,
        courseId,
        message: "Запись на бесплатный пробный урок / созвон",
        status: "NEW",
        stage: user.currentFunnelStage,
      },
    });
    await this.event(user.id, "TRIAL_REQUESTED", courseId, null, {
      requestId: request.id,
    });
    await this.notifyRequest(ctx, user, request.id, "📞 Новая заявка на пробный урок / созвон");
    await ctx.reply(t.trialSent, { reply_markup: menuKeyboard(user.language) });
  }

  async myCourses(ctx: Context, user: User) {
    const t = tr(user.language);
    const rows = await this.db.enrollment.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      include: { course: true, tariff: true },
      orderBy: { createdAt: "desc" },
    });
    if (!rows.length) {
      await ctx.reply(t.noCourses, { reply_markup: menuKeyboard(user.language) });
      return;
    }
    for (const row of rows) {
      const k = new InlineKeyboard();
      if (
        row.accessStatus === "GRANTED" &&
        row.telegramInviteLink &&
        (!row.inviteExpiresAt || row.inviteExpiresAt > new Date())
      )
        k.url(user.language === "KZ" ? "🎓 Оқуға өту" : "🎓 Перейти к обучению", row.telegramInviteLink);
      else k.text(t.accessPending, "c:noop");
      await ctx.reply(
        "📚 " +
          title(user.language, row.course) +
          (row.tariff
            ? "\n" +
              (user.language === "KZ"
                ? row.tariff.titleKz || row.tariff.titleRu
                : row.tariff.titleRu)
            : ""),
        { reply_markup: k },
      );
    }
    await ctx.reply(t.mainMenu, { reply_markup: menuKeyboard(user.language) });
  }

  async callback(ctx: Context, data: string) {
    const user = await this.ensureUser(ctx);
    const [prefix, action, value] = data.split(":");
    if (prefix !== "c") return false;
    if (action === "noop") return true;
    if (action === "language") {
      await ctx.reply(tr(user.language).chooseLanguage, { reply_markup: langKeyboard() });
      return true;
    }
    if (action === "lang") {
      if (!["RU", "KZ"].includes(value)) throw new AppError("Некорректный язык");
      const language = value as Language;
      const updated = await this.db.user.update({
        where: { id: user.id },
        data: { language, conversationStep: "PRIMARY_GOAL" },
      });
      await this.event(user.id, "LANGUAGE_SELECTED", null, null, { language });
      await this.welcome(ctx, updated);
      return true;
    }
    if (!user.language) {
      await ctx.reply(tr(null).chooseLanguage, { reply_markup: langKeyboard() });
      return true;
    }
    if (action === "menu") await this.showMenu(ctx, user);
    else if (action === "welcome") await this.welcome(ctx, user);
    else if (action === "goal") {
      if (value === "PROFESSIONAL") await this.professional(ctx, user);
      else if (value === "FAMILY") await this.family(ctx, user);
      else if (value === "BEAUTY") await this.beauty(ctx, user);
      else throw new AppError("Некорректный выбор");
    } else if (action === "exp") {
      if (!["BEGINNER", "PRACTICING"].includes(value))
        throw new AppError("Некорректный выбор");
      await this.db.user.update({
        where: { id: user.id },
        data: {
          experienceLevel: value as "BEGINNER" | "PRACTICING",
          conversationStep: "IDLE",
          currentFunnelStage: "QUESTIONNAIRE_COMPLETED",
        },
      });
      await this.event(user.id, "QUALIFICATION_ANSWERED", null, null, {
        experience: value,
      });
      const t = tr(user.language);
      const professionalMessage =
        value === "BEGINNER"
          ? t.professionalBenefit
          : t.professionalExperiencedBenefit;
      await ctx.reply(professionalMessage, {
        reply_markup: new InlineKeyboard().text(t.professionalBonus, "c:bonus:professional"),
      });
    } else if (action === "family") {
      // Backward compatibility for old inline buttons that may still exist
      // in previously sent messages. The diagnostic step has been removed.
      await this.db.user.update({
        where: { id: user.id },
        data: {
          familyProblem: null,
          conversationStep: "IDLE",
          currentFunnelStage: "QUESTIONNAIRE_COMPLETED",
        },
      });
      const t = tr(user.language);
      await ctx.reply(t.familyBenefit, {
        reply_markup: new InlineKeyboard().text(t.familyBonus, "c:bonus:family"),
      });
    } else if (action === "beauty") {
      if (!["NAILS", "HAIR", "DEPILATION", "LASH_BROW_COSMETOLOGY"].includes(value))
        throw new AppError("Некорректный выбор");
      await this.db.user.update({
        where: { id: user.id },
        data: {
          beautyProfession: value as BeautyProfession,
          conversationStep: "IDLE",
          currentFunnelStage: "QUESTIONNAIRE_COMPLETED",
        },
      });
      await this.event(user.id, "QUALIFICATION_ANSWERED", null, null, {
        beautyProfession: value,
      });
      const t = tr(user.language);
      const answer =
        value === "NAILS"
          ? t.beautyNails
          : value === "HAIR"
            ? t.beautyHair
            : value === "DEPILATION"
              ? t.beautyDepilation
              : t.beautyLashes;
      const message = answer
        ? answer + "\n\n" + t.beautyBonusText
        : t.beautyBonusText;
      await ctx.reply(message, {
        reply_markup: new InlineKeyboard().text(t.beautyBonus, "c:bonus:beauty"),
      });
    } else if (action === "bonus") {
      if (!["professional", "family", "beauty"].includes(value))
        throw new AppError("Некорректный бонус");
      await this.sendBonus(ctx, user, value as "professional" | "family" | "beauty");
      if (value === "professional") await this.listCourses(ctx, user, "professional");
      else if (value === "family") {
        await this.listCourses(ctx, user, "home");
      } else {
        const current = await this.db.user.findUniqueOrThrow({ where: { id: user.id } });
        const recommended =
          current.beautyProfession === "NAILS"
            ? ["express-hands"]
            : current.beautyProfession === "HAIR"
              ? ["express-neck-head"]
              : current.beautyProfession === "DEPILATION"
                ? ["express-legs"]
                : ["express-face", "guasha"];
        await this.listCourses(ctx, user, "beauty", recommended);
      }
    } else if (action === "segment") {
      if (!["professional", "home", "beauty", "additional"].includes(value))
        throw new AppError("Некорректная категория");
      await this.listCourses(ctx, user, value);
    } else if (action === "course") await this.showCourse(ctx, user, value);
    else if (action === "tariffs") await this.showTariffs(ctx, user, value);
    else if (action === "tariff") await this.selectTariff(ctx, user, value);
    else if (action === "buy") await this.buySingle(ctx, user, value);
    else if (action === "country") {
      if (!["KZ", "RU"].includes(value)) throw new AppError("Некорректная страна");
      await this.checkout(ctx, user, value as Country);
    } else if (action === "paid") {
      const payment = await this.db.payment.findUniqueOrThrow({ where: { id: value } });
      if (payment.userId !== user.id) throw new AppError("Оплата недоступна");
      if (!["PENDING", "REJECTED"].includes(payment.status))
        throw new AppError("Оплата уже передана на проверку или обработана");

      const isKaspiLink =
        payment.country === "KZ" &&
        payment.paymentMethod.toLowerCase().includes("kaspi") &&
        payment.requisites.startsWith("https://pay.kaspi.kz/");

      await this.db.user.update({
        where: { id: user.id },
        data: { activePaymentId: payment.id, conversationStep: "RECEIPT" },
      });
      await ctx.reply(
        isKaspiLink ? tr(user.language).sendKaspiPdf : tr(user.language).sendReceipt,
        { reply_markup: backMenu(user.language) },
      );
    } else if (action === "ask") {
      await this.ask(ctx, user, value === "none" ? undefined : value);
    } else if (action === "trial") await this.trial(ctx, user, value);
    else if (action === "my") await this.myCourses(ctx, user);
    else throw new AppError("Неизвестное действие");
    return true;
  }

  async notifyRequest(ctx: Context, user: User, requestId: string, heading: string) {
    const admins = await this.db.adminUser.findMany({
      where: { active: true, telegramId: { not: null } },
    });
    const text =
      heading +
      "\nКлиент: " +
      user.firstName +
      (user.telegramUsername ? " @" + user.telegramUsername : "") +
      "\nTelegram ID: " +
      user.telegramId +
      "\nЗапрос: " +
      requestId;
    for (const admin of admins) {
      if (!admin.telegramId) continue;
      await ctx.api
        .sendMessage(admin.telegramId.toString(), text, {
          reply_markup: new InlineKeyboard().text(
            "💬 Открыть запрос",
            "a:card:requests:" + requestId,
          ),
        })
        .catch(() => {});
    }
  }

  async notifyPayment(ctx: Context, user: User, paymentId: string) {
    const payment = await this.db.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { course: true, tariff: true },
    });
    const admins = await this.db.adminUser.findMany({
      where: {
        active: true,
        telegramId: { not: null },
        role: { in: ["OWNER", "ADMIN"] },
      },
    });
    const caption =
      "💳 Новая оплата на проверку\n" +
      "Клиент: " +
      user.firstName +
      (user.telegramUsername ? " @" + user.telegramUsername : "") +
      "\nTelegram ID: " +
      user.telegramId +
      "\nКурс: " +
      payment.course.title +
      "\nТариф: " +
      (payment.tariff?.titleRu ?? "—") +
      "\nСумма: " +
      money(payment.amount) +
      " " +
      payment.currency +
      (payment.country === "KZ" && payment.paymentMethod.toLowerCase().includes("kaspi")
        ? "\n\n⚠️ Подтверждайте только после проверки фактического поступления в Kaspi Pay."
        : "");
    const keyboard = new InlineKeyboard()
      .text("✅ Подтвердить", "a:approve:" + payment.id)
      .text("❌ Отклонить", "a:reject:" + payment.id)
      .row()
      .text("👤 Клиент", "a:card:clients:" + user.id);
    for (const admin of admins) {
      if (!admin.telegramId) continue;
      try {
        if (payment.receiptFileId && payment.receiptType === "photo")
          await ctx.api.sendPhoto(admin.telegramId.toString(), payment.receiptFileId, {
            caption,
            reply_markup: keyboard,
          });
        else if (payment.receiptFileId)
          await ctx.api.sendDocument(admin.telegramId.toString(), payment.receiptFileId, {
            caption,
            reply_markup: keyboard,
          });
        else
          await ctx.api.sendMessage(admin.telegramId.toString(), caption, {
            reply_markup: keyboard,
          });
      } catch {
        await ctx.api
          .sendMessage(admin.telegramId.toString(), caption, {
            reply_markup: keyboard,
          })
          .catch(() => {});
      }
    }
  }

  async message(ctx: Context) {
    const user = await this.ensureUser(ctx);
    const t = tr(user.language);
    if (user.conversationStep === "RECEIPT") {
      if (!user.activePaymentId) throw new AppError("Активная оплата не найдена");
      const payment = await this.db.payment.findUniqueOrThrow({
        where: { id: user.activePaymentId },
        include: { course: true, tariff: true },
      });
      if (payment.userId !== user.id) throw new AppError("Оплата недоступна");

      const isKaspi =
        payment.country === "KZ" &&
        payment.paymentMethod.toLowerCase().includes("kaspi") &&
        payment.requisites.startsWith("https://pay.kaspi.kz/");

      if (isKaspi) {
        const doc = ctx.message?.document;
        if (!doc || doc.mime_type !== "application/pdf") {
          await ctx.reply(t.kaspiPdfOnly);
          return true;
        }
        if (doc.file_size && doc.file_size > 10_000_000) {
          await ctx.reply(t.kaspiPdfTooLarge);
          return true;
        }
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const merchantBin = process.env.KASPI_MERCHANT_BIN;
        const maxAge = Number(process.env.KASPI_RECEIPT_MAX_AGE_MINUTES || "1440");
        if (!token || !merchantBin) {
          await ctx.reply(
            user.language === "KZ"
              ? "Автоматты Kaspi тексеруі әзірге толық бапталмаған. Әкімшіге хабар берілді."
              : "Автоматическая проверка Kaspi пока не полностью настроена. Администратор уведомлён.",
          );
          return true;
        }

        await ctx.reply(t.kaspiPdfChecking);
        try {
          const file = await ctx.api.getFile(doc.file_id);
          if (!file.file_path) throw new Error("Telegram file path is missing");
          const response = await fetch(
            `https://api.telegram.org/file/bot${token}/${file.file_path}`,
            { signal: AbortSignal.timeout(10_000) },
          );
          if (!response.ok) throw new Error(`Telegram file HTTP ${response.status}`);
          const pdf = Buffer.from(await response.arrayBuffer());
          if (pdf.length > 10_000_000) throw new Error("Receipt PDF is too large");

          const verification = await verifyKaspiReceiptPdf({
            buffer: pdf,
            expectedAmount: Number(payment.amount),
            expectedMerchantBin: merchantBin,
            maxAgeMinutes: Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 1440,
            paymentRequestedAt: payment.createdAt,
          });

          if (!verification.ok) {
            const reviewable = new Set([
              "receipt_id_unreadable",
              "fetch_failed",
              "not_fiscal",
              "amount_unreadable",
              "merchant_unreadable",
              "date_unreadable",
              "pdf_unreadable",
            ]);

            if (reviewable.has(verification.code)) {
              const hash = createHash("sha256").update(pdf).digest("hex");
              const duplicate = await this.db.payment.findFirst({
                where: {
                  id: { not: payment.id },
                  OR: [{ receiptHash: hash }],
                },
              });
              if (duplicate) {
                await ctx.reply(t.kaspiReceiptUsed);
                return true;
              }
              await this.db.$transaction(async (tx) => {
                await tx.payment.update({
                  where: { id: payment.id },
                  data: {
                    status: "PENDING_REVIEW",
                    receiptFileId: doc.file_id,
                    receiptType: "document",
                    receiptHash: hash,
                    receiptRevision: { increment: 1 },
                    rejectionReason: verification.code,
                  },
                });
                await tx.user.update({
                  where: { id: user.id },
                  data: {
                    conversationStep: "IDLE",
                    currentFunnelStage: "PAYMENT_REVIEW",
                  },
                });
              });
              const updated = await this.db.user.findUniqueOrThrow({ where: { id: user.id } });
              await this.notifyPayment(ctx, updated, payment.id);
              await ctx.reply(t.kaspiReceiptReviewPending, {
                reply_markup: menuKeyboard(user.language),
              });
              return true;
            }

            const localized =
              verification.code === "amount_mismatch"
                ? (user.language === "KZ"
                    ? "Чектегі сома таңдалған тариф бағасына сәйкес келмейді."
                    : "Сумма в чеке не совпадает со стоимостью выбранного тарифа.")
                : verification.code === "merchant_mismatch"
                  ? (user.language === "KZ"
                      ? "Чек басқа алушыға рәсімделген."
                      : "Чек выписан другому получателю.")
                  : verification.code === "too_old"
                    ? (user.language === "KZ"
                        ? "Бұл чек тексеру мерзімінен ескі."
                        : "Этот чек слишком старый для текущей оплаты.")
                    : verification.code === "future_date"
                      ? (user.language === "KZ"
                          ? "Чек күні дұрыс емес."
                          : "Дата или время чека некорректны.")
                      : verification.message;
            await ctx.reply("❌ " + localized.replace(/^❌\s*/, ""));
            return true;
          }

          const hash = createHash("sha256").update(pdf).digest("hex");
          const receipt = verification.receipt;
          const duplicate = await this.db.payment.findFirst({
            where: {
              id: { not: payment.id },
              OR: [{ receiptHash: hash }, { receiptKey: receipt.receiptKey }],
            },
          });
          if (duplicate) {
            await ctx.reply(t.kaspiReceiptUsed);
            return true;
          }

          await this.db.$transaction(async (tx) => {
            await tx.payment.update({
              where: { id: payment.id },
              data: {
                status: "PENDING_REVIEW",
                receiptFileId: doc.file_id,
                receiptType: "document",
                receiptHash: hash,
                receiptKey: receipt.receiptKey,
                receiptUrl: receipt.url,
                receiptDate: receipt.receiptDate,
                receiptMerchantBin: receipt.merchantBin,
                verifiedAt: new Date(),
                receiptRevision: { increment: 1 },
                rejectionReason: null,
              },
            });
            await tx.user.update({
              where: { id: user.id },
              data: {
                conversationStep: "IDLE",
                currentFunnelStage: "PAYMENT_REVIEW",
              },
            });
            await tx.funnelEvent.create({
              data: {
                userId: user.id,
                courseId: payment.courseId,
                tariffId: payment.tariffId,
                type: "KASPI_RECEIPT_VERIFIED",
                metadata: {
                  paymentId: payment.id,
                  receiptKey: receipt.receiptKey,
                },
              },
            });
          });

          const owner = await this.db.adminUser.findFirst({
            where: { role: "OWNER", active: true },
            orderBy: { createdAt: "asc" },
          });
          if (!owner) throw new Error("Active OWNER admin not found");

          await new PaymentService(this.db).review(owner.id, payment.id, true);
          const enrollment = await this.db.enrollment.findUnique({
            where: { paymentId: payment.id },
          });

          let invite: string | null = null;
          if (enrollment) {
            const access = await new AccessService(
              this.db,
              new GrammyGateway(ctx.api),
            ).retry(enrollment.id, owner.id);
            if (
              access.accessStatus === "GRANTED" &&
              access.telegramInviteLink &&
              (!access.inviteExpiresAt || access.inviteExpiresAt > new Date())
            ) {
              invite = access.telegramInviteLink;
            }
          }

          const buttons = new InlineKeyboard();
          if (invite)
            buttons.url(
              user.language === "KZ" ? "🎓 Оқуға өту" : "🎓 Перейти к обучению",
              invite,
            ).row();
          buttons.text(t.mainMenu, "c:menu");

          await ctx.reply(
            t.kaspiReceiptApproved +
              (invite ? "" : "\n\n" + t.approvedManual),
            { reply_markup: buttons },
          );
          return true;
        } catch (error) {
          console.error("Automatic Kaspi receipt verification failed:", safeError(error));
          await ctx.reply(t.kaspiReceiptApplyFailed);
          return true;
        }
      }

      const photo = ctx.message?.photo?.at(-1);
      const doc = ctx.message?.document;
      if (!photo && !doc) {
        await ctx.reply(t.sendReceipt);
        return true;
      }
      const fileId = photo?.file_id ?? doc!.file_id;
      const receiptType = photo ? "photo" : "document";
      await this.db.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: "PENDING_REVIEW",
            receiptFileId: fileId,
            receiptType,
            receiptRevision: { increment: 1 },
          },
        });
        await tx.user.update({
          where: { id: user.id },
          data: {
            conversationStep: "IDLE",
            currentFunnelStage: "PAYMENT_REVIEW",
          },
        });
        await tx.funnelEvent.create({
          data: {
            userId: user.id,
            courseId: payment.courseId,
            tariffId: payment.tariffId,
            type: "RECEIPT_UPLOADED",
            metadata: { paymentId: payment.id },
          },
        });
      });
      const updated = await this.db.user.findUniqueOrThrow({ where: { id: user.id } });
      await ctx.reply(t.receiptReceived, { reply_markup: menuKeyboard(user.language) });
      await this.notifyPayment(ctx, updated, payment.id);
      return true;
    }

    if (user.conversationStep === "MANAGER_MESSAGE") {
      const text = ctx.message?.text?.trim();
      if (!text) {
        await ctx.reply(t.questionPrompt);
        return true;
      }
      if (text.length > 1500) {
        await ctx.reply(user.language === "KZ" ? "Сұрақ тым ұзын. 1500 таңбаға дейін жазыңыз." : "Сообщение слишком длинное. До 1500 символов.");
        return true;
      }
      const request = await this.db.managerRequest.create({
        data: {
          userId: user.id,
          courseId: user.selectedCourseId,
          message: text,
          status: "NEW",
          stage: user.currentFunnelStage,
        },
      });
      await this.db.user.update({
        where: { id: user.id },
        data: { conversationStep: "IDLE", currentFunnelStage: "MANAGER_REQUESTED" },
      });
      await this.event(user.id, "MANAGER_REQUESTED", user.selectedCourseId, user.selectedTariffId, {
        requestId: request.id,
      });
      await this.notifyRequest(ctx, user, request.id, "💬 Новый вопрос клиента");
      await ctx.reply(t.questionSent, { reply_markup: menuKeyboard(user.language) });
      return true;
    }
    return false;
  }

  async safeCallback(ctx: Context, data: string) {
    try {
      return await this.callback(ctx, data);
    } catch (error) {
      const user = await this.ensureUser(ctx).catch(() => null);
      await ctx
        .reply(
          user?.language === "KZ"
            ? "Әрекетті орындау мүмкін болмады. Қайта көріңіз немесе басты мәзірге оралыңыз."
            : "Не удалось выполнить действие. Попробуйте ещё раз или вернитесь в главное меню.",
          user ? { reply_markup: menuKeyboard(user.language) } : undefined,
        )
        .catch(() => {});
      console.error("Client callback failed:", safeError(error));
      return true;
    }
  }
}
