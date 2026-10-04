import { Bot } from "grammy";
import { PrismaClient } from "@prisma/client";
import { AppError, recordError } from "../lib/errors";
import { Conversations } from "../services/conversations";
import { AdminViews } from "./admin/views";
import { WizardView } from "./admin/wizards";
import { authenticate } from "./middleware/admin";
import { registerAdmin } from "./commands/admin";
import { callback } from "./callbacks/admin";
import { ClientBot } from "./client";

export function createBot(token: string, db: PrismaClient, username?: string) {
  const bot = new Bot(token),
    flows = new Conversations(db),
    views = new AdminViews(db, flows, username),
    wizard = new WizardView(db, flows),
    client = new ClientBot(db);

  bot.use(async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (!(error instanceof AppError) || error.status !== 403)
        await recordError(db, error, {
          updateId: ctx.update.update_id,
          section: "bot",
        });

      const text =
        error instanceof AppError
          ? error.message
          : "Не удалось выполнить действие. Попробуйте ещё раз.";

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

  // /start is always the client flow, including for OWNER/ADMIN.
  // Administration remains available separately through /admin.
  bot.command("start", async (ctx) => {
    await client.start(ctx);
  });

  bot.command("menu", async (ctx) => {
    const user = await client.ensureUser(ctx);
    if (!user.language) {
      await client.start(ctx);
      return;
    }
    await client.showMenu(ctx, user);
  });

  registerAdmin(bot, db, views, flows);

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data.startsWith("c:")) {
      await client.safeCallback(ctx, data);
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }

    const admin = await authenticate(ctx, db);
    await callback(ctx, admin, db, views, wizard, flows);
    await ctx.answerCallbackQuery().catch(() => {});
  });

  bot.on("message", async (ctx) => {
    if (!ctx.from || ctx.chat.type !== "private") return;

    // Commands not handled above should not be interpreted as client text.
    if (ctx.message.text?.startsWith("/")) {
      const admin = await db.adminUser.findUnique({
        where: { telegramId: BigInt(ctx.from.id) },
      });
      if (admin?.active)
        await ctx.reply("Доступны /start, /menu, /admin и /cancel.");
      else await ctx.reply("Доступны /start и /menu.");
      return;
    }

    // If an administrator is currently inside an admin wizard, keep that
    // workflow isolated from the client sales conversation.
    const admin = await db.adminUser.findUnique({
      where: { telegramId: BigInt(ctx.from.id) },
    });
    if (admin?.active) {
      const state = await db.adminConversationState.findUnique({
        where: { adminId: admin.id },
      });
      if (state) {
        const result = await wizard.message(ctx, admin);
        if (result && typeof result === "object")
          await views.list(ctx, admin, "clients", "search", 0);
        return;
      }
    }

    if (await client.message(ctx)) return;

    const user = await client.ensureUser(ctx);
    if (!user.language) await client.start(ctx);
    else await client.showMenu(ctx, user);
  });

  bot.catch(async (error) => {
    await recordError(db, error.error, { section: "bot-catch" });
  });

  return bot;
}
