import { t } from "../../i18n";
import { Context } from "grammy";
import { AdminUser, PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors";
export async function authenticate(
  ctx: Context,
  db: PrismaClient,
): Promise<AdminUser> {
  if (ctx.chat?.type !== "private" || !ctx.from)
    throw new AppError(t("error.denied"), 403);
  const admin = await db.adminUser.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
  });
  if (!admin?.active) throw new AppError(t("error.denied"), 403);
  return db.adminUser.update({
    where: { id: admin.id },
    data: { lastActivityAt: new Date(), username: ctx.from.username ?? null },
  });
}
