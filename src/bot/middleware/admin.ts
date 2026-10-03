import { Context } from "grammy";
import { AdminUser, PrismaClient } from "@prisma/client";
import { AppError } from "../../lib/errors";
export async function authenticate(
  ctx: Context,
  db: PrismaClient,
): Promise<AdminUser> {
  if (ctx.chat?.type !== "private" || !ctx.from)
    throw new AppError("Команда недоступна.", 403);
  const admin = await db.adminUser.findUnique({
    where: { telegramId: BigInt(ctx.from.id) },
  });
  if (!admin?.active) throw new AppError("Команда недоступна.", 403);
  return admin;
}
