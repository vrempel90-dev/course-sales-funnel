import type { Prisma, PrismaClient, Role } from "@prisma/client";
import { AppError } from "../lib/errors";
import { atomic } from "./transaction";
export type Section =
  | "stats"
  | "clients"
  | "courses"
  | "categories"
  | "rules"
  | "payments"
  | "access"
  | "requests"
  | "staff"
  | "requisites"
  | "settings";
export function permitted(role: Role, section: Section, write = false) {
  if (role === "OWNER") return true;
  if (["staff", "requisites", "settings"].includes(section)) return false;
  if (role === "ADMIN") return true;
  return write
    ? ["clients", "requests"].includes(section)
    : ["stats", "clients", "courses", "payments", "requests"].includes(section);
}
export async function requireAdmin(
  db: PrismaClient | Prisma.TransactionClient,
  id: string,
  section: Section,
  write = false,
) {
  const admin = await db.adminUser.findUnique({ where: { id } });
  if (!admin?.active || !permitted(admin.role, section, write))
    throw new AppError("Команда недоступна.", 403);
  return admin;
}
export async function bootstrapOwner(db: PrismaClient, telegramId?: string) {
  if (!telegramId) return null;
  if (!/^[1-9]\d{0,15}$/.test(telegramId))
    throw new AppError("Invalid OWNER_TELEGRAM_ID");
  return atomic(db, async (tx) => {
    const existing = await tx.adminUser.findUnique({
      where: { telegramId: BigInt(telegramId) },
    });
    if (existing) {
      if (
        existing.role !== "OWNER" &&
        !(await tx.adminUser.count({ where: { role: "OWNER" } }))
      ) {
        const upgraded = await tx.adminUser.update({
          where: { id: existing.id },
          data: { role: "OWNER", active: true },
        });
        await tx.auditLog.create({
          data: {
            adminId: upgraded.id,
            action: "ROLE_CHANGED",
            entityType: "AdminUser",
            entityId: upgraded.id,
            metadata: { bootstrap: true },
          },
        });
        return upgraded;
      }
      return existing;
    }
    const owner = await tx.adminUser.create({
      data: { name: "Owner", telegramId: BigInt(telegramId), role: "OWNER" },
    });
    await tx.auditLog.create({
      data: {
        adminId: owner.id,
        action: "ADMIN_CREATED",
        entityType: "AdminUser",
        entityId: owner.id,
        metadata: { bootstrap: true },
      },
    });
    return owner;
  });
}
