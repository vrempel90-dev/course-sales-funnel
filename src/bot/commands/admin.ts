import { Bot } from "grammy";
import { PrismaClient } from "@prisma/client";
import { authenticate } from "../middleware/admin";
import { Conversations } from "../../services/conversations";
import { AdminViews } from "../admin/views";
export function registerAdmin(
  bot: Bot,
  db: PrismaClient,
  views: AdminViews,
  flows: Conversations,
) {
  bot.command("admin", async (ctx) => {
    const admin = await authenticate(ctx, db);
    await flows.cancel(admin.id);
    await views.home(ctx, admin);
  });
  bot.command("cancel", async (ctx) => {
    const admin = await authenticate(ctx, db);
    await flows.cancel(admin.id);
    await views.home(ctx, admin);
  });
}
