import { createHmac, randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "../database/client";
import { hashPassword, verifyPassword } from "./password";
import { AppError } from "./errors";
import { atomic } from "../services/transaction";
export const cookieName = "funnel_session";
export { hashPassword };
function sessionHash(token: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new AppError(
      "SESSION_SECRET должен содержать минимум 32 символа",
      503,
    );
  return createHmac("sha256", secret).update(token).digest("hex");
}
export async function currentAdmin() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token || token.length !== 64) return null;
  const session = await db.adminSession.findUnique({
    where: { id: sessionHash(token) },
    include: { admin: true },
  });
  if (!session || session.expiresAt < new Date() || !session.admin.active)
    return null;
  const { id, name, email, role, telegramId } = session.admin;
  return { id, name, email, role, telegramId };
}
export async function requireAdmin() {
  const admin = await currentAdmin();
  if (!admin) throw new AppError("Требуется вход", 401);
  return admin;
}
export function verifyOrigin(request: Request) {
  const configured = process.env.APP_URL;
  if (
    !configured ||
    request.headers.get("origin") !== new URL(configured).origin
  )
    throw new AppError("Недопустимый источник запроса", 403);
}
export async function login(email: string, password: string) {
  // Rate limiting is shared across replicas and survives restarts.
  const key = createHash("sha256").update(email).digest("hex");
  const allowed = await atomic(db, async (tx) => {
    let entry = await tx.loginAttempt.upsert({
      where: { id: key },
      update: {},
      create: { id: key },
    });
    if (entry.lockedUntil && entry.lockedUntil > new Date()) return false;
    if (Date.now() - entry.windowStartedAt.getTime() > 15 * 60000)
      entry = await tx.loginAttempt.update({
        where: { id: key },
        data: { failures: 0, lockedUntil: null, windowStartedAt: new Date() },
      });
    await tx.loginAttempt.update({
      where: { id: key },
      data: {
        failures: { increment: 1 },
        ...(entry.failures >= 4
          ? { lockedUntil: new Date(Date.now() + 15 * 60000) }
          : {}),
      },
    });
    return true;
  });
  if (!allowed)
    throw new AppError("Слишком много попыток. Повторите через 15 минут", 429);
  const admin = await db.adminUser.findUnique({ where: { email } });
  const dummy = "scrypt:00000000000000000000000000000000:" + "00".repeat(64);
  const valid = await verifyPassword(password, admin?.passwordHash || dummy);
  if (!valid || !admin?.active)
    throw new AppError("Неверные данные для входа", 401);
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 12 * 3600000);
  await db.$transaction([
    db.loginAttempt.update({
      where: { id: key },
      data: { failures: 0, lockedUntil: null },
    }),
    db.adminSession.create({
      data: { id: sessionHash(token), adminId: admin.id, expiresAt },
    }),
  ]);
  return { token, expiresAt };
}
export async function logout() {
  const token = (await cookies()).get(cookieName)?.value;
  if (token)
    await db.adminSession.deleteMany({ where: { id: sessionHash(token) } });
}
