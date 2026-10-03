import { Bot, Context } from "grammy";
import { PrismaClient } from "@prisma/client";
import { WorkflowService } from "../services/workflow";
import { PaymentService } from "../services/payments";
import { ManagerService } from "../services/manager";
import { AppError, safeError } from "../lib/errors";
import { mainMenu } from "./keyboards/menu";
import { registerCommands } from "./commands/register";
import { registerCallbacks } from "./callbacks/register";
export function createBot(token: string, db: PrismaClient) {
  const bot = new Bot<Context>(token, { client: { timeoutSeconds: 20 } });
  const workflow = new WorkflowService(db);
  const payments = new PaymentService(db);
  const manager = new ManagerService(db);
  // The inbox is processed in order by the worker. No critical state lives in memory.
  bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot && ctx.chat?.type === "private")
      await workflow.user(ctx.from);
    try {
      await next();
    } catch (error) {
      await db.telegramBotError.create({
        data: { context: "handler", message: safeError(error) },
      });
      if (ctx.chat)
        await ctx.reply(
          error instanceof AppError
            ? error.message
            : "Не удалось выполнить действие. Попробуйте ещё раз или свяжитесь с менеджером.",
          { reply_markup: mainMenu() },
        );
      if (!(error instanceof AppError)) throw error;
    }
  });
  bot.on("message", async (ctx, next) => {
    const origin = ctx.message.forward_origin;
    if (ctx.chat.type === "private" && origin?.type === "channel") {
      const admin = await db.adminUser.findUnique({
        where: { telegramId: BigInt(ctx.from.id) },
      });
      if (admin?.active && admin.role === "ADMIN") {
        await ctx.reply(`Исходный Telegram Channel ID: ${origin.chat.id}`);
        return;
      }
    }
    await next();
  });
  registerCommands(bot, db, workflow);
  registerCallbacks(bot, db, workflow, payments, manager);
  bot.on("message:contact", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const user = await workflow.user(ctx.from);
    await workflow.contact(user.id, ctx.from.id, ctx.message.contact);
    await ctx.reply("Номер сохранён. Спасибо!", { reply_markup: mainMenu() });
  });
  bot.on(["message:photo", "message:document"], async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const user = await workflow.user(ctx.from);
    const file = ctx.message.photo?.at(-1) ?? ctx.message.document;
    if (!file) return;
    if ((file.file_size ?? 0) > 20 * 1024 * 1024)
      throw new AppError("Чек должен быть не больше 20 MB");
    await payments.receipt(
      user.id,
      file.file_id,
      ctx.message.photo ? "photo" : "document",
    );
    await ctx.reply(
      "Спасибо! Чек получен и отправлен на проверку.\nПосле подтверждения оплаты я автоматически отправлю вам доступ к обучению.",
      { reply_markup: mainMenu() },
    );
  });
  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const user = await workflow.user(ctx.from);
    if (ctx.message.text === "Главное меню") {
      await ctx.reply("Главное меню", { reply_markup: mainMenu() });
      return;
    }
    if (user.conversationStep === "MANAGER_MESSAGE") {
      await manager.message(user.id, ctx.message.text);
      await ctx.reply("Вопрос передан менеджеру.", {
        reply_markup: mainMenu(),
      });
    } else
      await ctx.reply("Выберите действие в меню.", {
        reply_markup: mainMenu(),
      });
  });
  bot.on("chat_member", async (ctx) => {
    const change = ctx.chatMember;
    const status = change.new_chat_member.status;
    if (
      status === "member" ||
      status === "administrator" ||
      status === "creator"
    )
      await db.enrollment.updateMany({
        where: {
          user: { telegramId: BigInt(change.new_chat_member.user.id) },
          course: { telegramChannelId: ctx.chat.id.toString() },
          status: "ACTIVE",
        },
        data: { joinedAt: new Date() },
      });
  });
  return bot;
}
