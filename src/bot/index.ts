import { Bot } from "grammy";
import { PrismaClient } from "@prisma/client";
import { t, translateMessage } from "../i18n";
import { AppError, recordError } from "../lib/errors";
import { Conversations } from "../services/conversations";
import { AdminViews } from "./admin/views";
import { WizardView } from "./admin/wizards";
import { authenticate } from "./middleware/admin";
import { registerAdmin } from "./commands/admin";
import { callback } from "./callbacks/admin";
export function createBot(token: string, db: PrismaClient, username?: string) {
  const bot = new Bot(token),
    flows = new Conversations(db),
    views = new AdminViews(db, flows, username),
    wizard = new WizardView(db, flows);
  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 403)
        await recordError(db, error, {
          updateId: ctx.update.update_id,
          section: "admin",
        });
      const actor = ctx.from
        ? await db.adminUser
            .findUnique({ where: { telegramId: BigInt(ctx.from.id) } })
            .catch(() => null)
        : null;
      const text =
        error instanceof AppError
          ? error.status === 403
            ? t("common.denied", actor?.language)
            : translateMessage(error.message, actor?.language)
          : t("common.error", actor?.language);
      try {
        if (ctx.callbackQuery)
          await ctx.answerCallbackQuery({
            text: text.slice(0, 200),
            show_alert: true,
          });
        else await ctx.reply(text);
      } catch (replyError) {
        await recordError(db, replyError, { section: "error-reply" });
      }
    }
  });
  registerAdmin(bot, db, views, flows);
  bot.on("callback_query:data", async (ctx) => {
    const admin = await authenticate(ctx, db);
    await callback(ctx, admin, db, views, wizard, flows);
    await ctx.answerCallbackQuery().catch(() => {});
  });
  bot.on("message", async (ctx) => {
    if (ctx.message.text?.startsWith("/")) {
      const admin = await authenticate(ctx, db);
      await ctx.reply(t("common.commands", admin.language) + " " + admin.role);
      return;
    }
    const admin = await authenticate(ctx, db);
    const result = await wizard.message(ctx, admin);
    if (result && typeof result === "object")
      await views.list(ctx, admin, "clients", "search", 0);
    else if (!result) await ctx.reply(t("common.prompt", admin.language));
  });
  bot.catch(async (error) => {
    await recordError(db, error.error, { section: "bot-catch" });
  });
  return bot;
}
