import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient, Role } from "@prisma/client";
import { AppError } from "../lib/errors";
import { atomic } from "./transaction";
import { requireAdmin, Section } from "./auth";
import {
  adminSchema,
  categorySchema,
  courseSchema,
  ruleSchema,
  clientSchema,
  configSchema,
  defaultSettings,
  requisitesSchema,
} from "./schemas";
export type Entity =
  | "category"
  | "course"
  | "rule"
  | "admin"
  | "client"
  | "settings"
  | "requisites";
export const entitySection: Record<Entity, Section> = {
  category: "categories",
  course: "courses",
  rule: "rules",
  admin: "staff",
  client: "clients",
  settings: "settings",
  requisites: "requisites",
};
export async function audit(
  tx: Prisma.TransactionClient,
  adminId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await tx.auditLog.create({
    data: { adminId, action, entityType, entityId, metadata },
  });
}
export class AdminService {
  constructor(public db: PrismaClient) {}
  async save(
    adminId: string,
    entity: Entity,
    input: unknown,
    id?: string,
    nonce?: string,
  ) {
    return atomic(this.db, async (tx) => {
      await requireAdmin(tx, adminId, entitySection[entity], true);
      if (nonce) {
        const state = await tx.adminConversationState.findUnique({
          where: { adminId },
        });
        if (!state || state.nonce !== nonce || state.expiresAt < new Date())
          throw new AppError("Мастер устарел. Откройте его заново.");
        if (
          !(
            await tx.adminConversationState.deleteMany({
              where: { adminId, nonce },
            })
          ).count
        )
          throw new AppError("Действие уже выполнено");
      }
      return this.saveTx(tx, adminId, entity, input, id);
    });
  }
  async saveTx(
    tx: Prisma.TransactionClient,
    adminId: string,
    entity: Entity,
    input: unknown,
    id?: string,
  ) {
    await requireAdmin(tx, adminId, entitySection[entity], true);
    let result: { id: string };
    let action: string;
    if (entity === "category") {
      const data = categorySchema.parse(input);
      result = id
        ? await tx.courseCategory.update({ where: { id }, data })
        : await tx.courseCategory.create({
            data: { ...data, slug: "category-" + randomUUID() },
          });
      action = id ? "CATEGORY_UPDATED" : "CATEGORY_CREATED";
    } else if (entity === "course") {
      const data = courseSchema.parse(input);
      result = id
        ? await tx.course.update({ where: { id }, data })
        : await tx.course.create({
            data: { ...data, slug: "course-" + randomUUID() },
          });
      action = id
        ? data.status === "ARCHIVED"
          ? "COURSE_ARCHIVED"
          : "COURSE_UPDATED"
        : "COURSE_CREATED";
    } else if (entity === "rule") {
      const data = ruleSchema.parse(input);
      result = id
        ? await tx.recommendationRule.update({
            where: { id },
            data: { ...data, matchMode: "ALL" },
          })
        : await tx.recommendationRule.create({
            data: { ...data, matchMode: "ALL" },
          });
      action = id ? "RECOMMENDATION_UPDATED" : "RECOMMENDATION_CREATED";
    } else if (entity === "admin") {
      if (id) throw new AppError("Используйте управление ролью/активностью");
      const data = adminSchema.parse(input);
      result = await tx.adminUser.create({
        data: { ...data, telegramId: BigInt(data.telegramId) },
      });
      action = "ADMIN_CREATED";
    } else if (entity === "client") {
      if (!id) throw new AppError("Клиент не выбран");
      result = await tx.user.update({
        where: { id },
        data: clientSchema.parse(input),
      });
      action = "CLIENT_UPDATED";
      await tx.funnelEvent.create({
        data: { userId: id, type: "client_updated", metadata: { adminId } },
      });
    } else if (entity === "settings") {
      const data = configSchema.parse(input);
      await tx.setting.upsert({
        where: { key: "admin.settings" },
        update: { value: data },
        create: { key: "admin.settings", value: data },
      });
      await audit(
        tx,
        adminId,
        "SETTINGS_UPDATED",
        "Setting",
        "admin.settings",
        data,
      );
      return { id: "admin.settings" };
    } else {
      const data = requisitesSchema.parse(input);
      result = await tx.paymentMethodSetting.upsert({
        where: { country: data.country },
        update: { ...data, updatedBy: adminId },
        create: { ...data, updatedBy: adminId },
      });
      action = "PAYMENT_SETTINGS_UPDATED";
    }
    await audit(tx, adminId, action, entity, result.id);
    return result;
  }
  async changeStaff(
    adminId: string,
    id: string,
    change: { role?: Role; active?: boolean },
  ) {
    return atomic(this.db, async (tx) => {
      await requireAdmin(tx, adminId, "staff", true);
      const target = await tx.adminUser.findUniqueOrThrow({ where: { id } });
      if (
        target.active &&
        target.role === "OWNER" &&
        (change.active === false || (change.role && change.role !== "OWNER"))
      ) {
        const count = await tx.adminUser.count({
          where: { active: true, role: "OWNER" },
        });
        if (count <= 1)
          throw new AppError("Нельзя отключить или понизить последнего OWNER");
      }
      const updated = await tx.adminUser.update({
        where: { id },
        data: change,
      });
      await audit(
        tx,
        adminId,
        change.role
          ? "ROLE_CHANGED"
          : change.active
            ? "ADMIN_ENABLED"
            : "ADMIN_DISABLED",
        "AdminUser",
        id,
        { ...change },
      );
      if (!updated.active)
        await tx.adminConversationState.deleteMany({ where: { adminId: id } });
      return updated;
    });
  }
  async deleteRule(adminId: string, id: string) {
    return atomic(this.db, async (tx) => {
      await requireAdmin(tx, adminId, "rules", true);
      await tx.recommendationRule.delete({ where: { id } });
      await audit(
        tx,
        adminId,
        "RECOMMENDATION_DELETED",
        "RecommendationRule",
        id,
      );
    });
  }
  async request(
    adminId: string,
    id: string,
    status: "IN_PROGRESS" | "RESOLVED",
  ) {
    return atomic(this.db, async (tx) => {
      await requireAdmin(tx, adminId, "requests", true);
      const req = await tx.managerRequest.findUniqueOrThrow({ where: { id } });
      if (req.status === "RESOLVED" && status === "IN_PROGRESS")
        throw new AppError("Запрос уже закрыт");
      if (
        status === "IN_PROGRESS" &&
        req.assignedToAdminId &&
        req.assignedToAdminId !== adminId
      )
        throw new AppError("Запрос уже взят другим администратором");
      const updated = await tx.managerRequest.update({
        where: { id },
        data: { status, assignedToAdminId: req.assignedToAdminId || adminId },
      });
      await audit(tx, adminId, "REQUEST_UPDATED", "ManagerRequest", id, {
        status,
      });
      return updated;
    });
  }
  async settings() {
    return configSchema.parse(
      (await this.db.setting.findUnique({ where: { key: "admin.settings" } }))
        ?.value ?? defaultSettings,
    );
  }
}
