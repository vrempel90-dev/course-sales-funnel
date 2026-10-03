import { Bot, Context, InlineKeyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import { WorkflowService } from "../../services/workflow";
import { PaymentService } from "../../services/payments";
import { ManagerService } from "../../services/manager";
import { AppError } from "../../lib/errors";
import { botSettings } from "../../services/settings";
import { courseKeyboard, mainMenu } from "../keyboards/menu";
import { catalog, showQuestion } from "../conversations/questionnaire";
import { replyLong } from "../messages";
export function registerCallbacks(
  bot: Bot<Context>,
  db: PrismaClient,
  workflow: WorkflowService,
  payments: PaymentService,
  manager: ManagerService,
) {
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery();
    const [action, arg, extra, last] = ctx.callbackQuery.data.split(":");
    if (action === "approve" || action === "reject") {
      const admin = await db.adminUser.findUnique({
        where: { telegramId: BigInt(ctx.from.id) },
      });
      if (!admin?.active || admin.role !== "ADMIN")
        throw new AppError("Это действие доступно только администратору", 403);
      if (!/^\d+$/.test(extra || ""))
        throw new AppError("Кнопка устарела. Откройте новое уведомление.");
      await payments.review(
        arg,
        admin.id,
        action === "approve",
        action === "reject"
          ? "Проверьте чек или свяжитесь с менеджером."
          : undefined,
        Number(extra),
      );
      await ctx.reply(
        action === "approve"
          ? "Оплата подтверждена. Доступ будет отправлен через очередь."
          : "Оплата отклонена. Клиент получит уведомление.",
      );
      return;
    }
    if (ctx.chat?.type !== "private")
      throw new AppError("Откройте личный чат с ботом");
    const user = await workflow.user(ctx.from);
    if (action === "menu") {
      await ctx.reply("Главное меню", { reply_markup: mainMenu() });
      return;
    }
    if (action === "questionnaire") {
      await showQuestion(ctx, db, await workflow.questionnaire(user.id));
      return;
    }
    if (
      action === "q" &&
      ["experience", "category", "goal"].includes(extra) &&
      /^\d+$/.test(arg)
    ) {
      await showQuestion(
        ctx,
        db,
        await workflow.answer(
          user.id,
          Number(arg),
          extra as "experience" | "category" | "goal",
          last,
        ),
      );
      return;
    }
    if (action === "qback" && /^\d+$/.test(arg)) {
      await showQuestion(ctx, db, await workflow.back(user.id, Number(arg)));
      return;
    }
    if (action === "catalog") {
      await catalog(
        ctx,
        db,
        user,
        false,
        Math.max(1, Math.min(10000, Number(arg) || 1)),
      );
      return;
    }
    if (action === "open" || action === "demo" || action === "buy") {
      const course = await workflow.course(
        user.id,
        arg,
        action === "buy" ? "select" : action,
      );
      if (action === "open") {
        await replyLong(
          ctx,
          `${course.title}\n\n${course.fullDescription}\n\nПрограмма:\n${course.program}\n\nПродолжительность: ${course.duration}\n${course.priceKZT} KZT / ${course.priceRUB} RUB`,
          courseKeyboard(course.id),
        );
      } else if (action === "demo") {
        if (course.demoFileId) await ctx.replyWithVideo(course.demoFileId);
        else await ctx.reply(course.demoVideoUrl!);
        await ctx.reply(
          "Если программа вам подходит, можете перейти к покупке.",
          {
            reply_markup: new InlineKeyboard()
              .text("Купить курс", `buy:${course.id}`)
              .row()
              .text("Посмотреть другие программы", "catalog")
              .row()
              .text("Задать вопрос менеджеру", `manager:${course.id}`),
          },
        );
      } else
        await ctx.reply("Где вы будете оплачивать?", {
          reply_markup: new InlineKeyboard()
            .text("🇰🇿 Казахстан", `country:KZ:${course.id}`)
            .text("🇷🇺 Россия", `country:RU:${course.id}`)
            .row()
            .text("Назад", `open:${course.id}`)
            .text("Главное меню", "menu"),
        });
      return;
    }
    if (action === "country" && (arg === "KZ" || arg === "RU")) {
      const payment = await payments.create(user.id, extra, arg);
      if (payment.status === "PENDING_REVIEW") {
        await ctx.reply("Чек уже на проверке.", { reply_markup: mainMenu() });
        return;
      }
      const course = await db.course.findUniqueOrThrow({
        where: { id: payment.courseId },
      });
      await ctx.reply(
        `Курс: ${course.title}\nСтоимость: ${payment.amount} ${payment.currency}\nСпособ: ${payment.paymentMethod}\n\n${payment.instruction}\n${payment.requisites}\n\nПосле оплаты нажмите «Я оплатил» и отправьте чек.`,
        {
          reply_markup: new InlineKeyboard()
            .text("Я оплатил", `receipt:${payment.id}`)
            .row()
            .text("Задать вопрос", `manager:${course.id}`)
            .row()
            .text("Назад", `buy:${course.id}`)
            .text("Главное меню", "menu"),
        },
      );
      return;
    }
    if (action === "receipt") {
      await payments.waitReceipt(user.id, arg);
      await ctx.reply(
        "Отправьте, пожалуйста, чек об оплате: фотографию, PDF или document (до 20 MB).",
        { reply_markup: mainMenu() },
      );
      return;
    }
    if (action === "manager") {
      await manager.begin(user.id, arg || undefined);
      await ctx.reply(
        "Запрос менеджеру создан. Напишите ваш вопрос одним сообщением или продолжите через меню.",
        { reply_markup: mainMenu() },
      );
      return;
    }
    if (action === "help") {
      await ctx.reply((await botSettings(db)).helpText, {
        reply_markup: mainMenu(),
      });
      return;
    }
    if (action === "mycourses") {
      const enrollments = await db.enrollment.findMany({
        where: { userId: user.id, status: "ACTIVE" },
        include: { course: true },
        orderBy: { createdAt: "desc" },
      });
      await ctx.reply(
        enrollments.length ? "Ваши курсы:" : "У вас пока нет активных курсов.",
        { reply_markup: mainMenu() },
      );
      for (const enrollment of enrollments) {
        const linkValid =
          enrollment.telegramInviteLink &&
          enrollment.inviteExpiresAt &&
          enrollment.inviteExpiresAt > new Date();
        const keyboard = new InlineKeyboard();
        if (linkValid)
          keyboard.url("Перейти к обучению", enrollment.telegramInviteLink!);
        else if (enrollment.joinedAt && enrollment.course.telegramChannelId)
          keyboard.url(
            "Открыть канал",
            `https://t.me/c/${enrollment.course.telegramChannelId.replace(/^-100/, "")}/1`,
          );
        else
          keyboard.text("Помощь с доступом", `manager:${enrollment.courseId}`);
        await ctx.reply(
          `${enrollment.course.title}\nПокупка: ${enrollment.createdAt.toLocaleDateString("ru-RU")}\nСтатус: ${enrollment.status}\nДоступ: ${linkValid ? "Готов" : "Обратитесь к менеджеру для новой ссылки"}`,
          { reply_markup: keyboard },
        );
      }
      const pending = await db.payment.findMany({
        where: {
          userId: user.id,
          status: { in: ["PENDING", "REJECTED", "PENDING_REVIEW"] },
        },
        include: { course: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      for (const payment of pending)
        await ctx.reply(
          `${payment.course.title}: ${payment.status} • ${payment.amount} ${payment.currency}`,
          {
            reply_markup:
              payment.status === "PENDING_REVIEW"
                ? mainMenu()
                : new InlineKeyboard()
                    .text("Отправить чек", `receipt:${payment.id}`)
                    .text("Менеджер", `manager:${payment.courseId}`),
          },
        );
      return;
    }
    await db.telegramBotError.create({
      data: {
        context: "invalid_callback",
        message: ctx.callbackQuery.data.slice(0, 100),
      },
    });
    await ctx.reply("Кнопка устарела. Выберите действие в актуальном меню.", {
      reply_markup: mainMenu(),
    });
  });
}
