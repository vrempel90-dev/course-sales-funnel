import { t } from "../i18n";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient, Role } from "@prisma/client";
import { AppError } from "../lib/errors";
import {
  saveCategory,
  saveCourse,
  saveTariff,
  saveTranslation,
  saveFunnel,
  saveBonus,
  ensureTranslation,
  TranslationKind,
} from "./catalog";
import type { Language } from "@prisma/client";
import { atomic } from "./transaction";
import { requireAdmin, Section } from "./auth";
import {
  adminSchema,
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
  | "requisites"
  | "tariff"
  | "funnel"
  | "bonus"
  | "ct"
  | "kt"
  | "tt"
  | "bt";
export const entitySection: Record<Entity, Section> = {
  tariff: "tariffs",
  funnel: "funnel",
  bonus: "bonuses",
  ct: "courses",
  kt: "categories",
  tt: "tariffs",
  bt: "bonuses",
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
          throw new AppError(t("error.wizardRestart"));
        if (
          !(
            await tx.adminConversationState.deleteMany({
              where: { adminId, nonce },
            })
          ).count
        )
          throw new AppError(t("error.done"));
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
    let metadata: Prisma.InputJsonValue = {};
    if (entity === "category") {
      result = await saveCategory(tx, input, "category-" + randomUUID(), id);
      action = id ? "CATEGORY_UPDATED" : "CATEGORY_CREATED";
    } else if (entity === "course") {
      result = await saveCourse(tx, input, "course-" + randomUUID(), id);
      action = id
        ? "status" in result && result.status === "ARCHIVED"
          ? "COURSE_ARCHIVED"
          : "COURSE_UPDATED"
        : "COURSE_CREATED";
    } else if (entity === "tariff") {
      const previous = id
        ? await tx.courseTariff.findUniqueOrThrow({ where: { id } })
        : null;
      const tariff = await saveTariff(tx, input, id);
      result = tariff;
      action = !id
        ? "TARIFF_CREATED"
        : previous?.active && !tariff.active
          ? "TARIFF_DISABLED"
          : "TARIFF_UPDATED";
      metadata = {
        before: previous
          ? {
              priceKZT: previous.priceKZT.toString(),
              priceRUB: previous.priceRUB.toString(),
              active: previous.active,
            }
          : null,
        after: {
          priceKZT: tariff.priceKZT.toString(),
          priceRUB: tariff.priceRUB.toString(),
          active: tariff.active,
        },
      };
    } else if (["ct", "kt", "tt", "bt"].includes(entity)) {
      if (!id) throw new AppError(t("error.translationMissing"));
      result = await saveTranslation(tx, entity as TranslationKind, input, id);
      action =
        entity === "ct"
          ? "COURSE_UPDATED"
          : entity === "kt"
            ? "CATEGORY_UPDATED"
            : entity === "tt"
              ? "TARIFF_UPDATED"
              : "BONUS_UPDATED";
    } else if (entity === "funnel" || entity === "bonus") {
      if (!id) throw new AppError(t("error.recordMissing"));
      result =
        entity === "funnel"
          ? await saveFunnel(tx, input, id)
          : await saveBonus(tx, input, id);
      action = entity === "funnel" ? "FUNNEL_CONTENT_UPDATED" : "BONUS_UPDATED";
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
      if (id) throw new AppError(t("error.roleControls"));
      const data = adminSchema.parse(input);
      result = await tx.adminUser.create({
        data: { ...data, telegramId: BigInt(data.telegramId) },
      });
      action = "ADMIN_CREATED";
    } else if (entity === "client") {
      if (!id) throw new AppError(t("error.clientMissing"));
      const data = clientSchema.parse(input);
      if (data.selectedTariffId) {
        const tariff = await tx.courseTariff.findUniqueOrThrow({
          where: { id: data.selectedTariffId },
        });
        if (tariff.courseId !== data.selectedCourseId)
          throw new AppError(t("error.clientTariff"));
      }
      result = await tx.user.update({ where: { id }, data });
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
    await audit(tx, adminId, action, entity, result.id, metadata);
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
        if (count <= 1) throw new AppError(t("error.lastOwner"));
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
        throw new AppError(t("error.requestClosed"));
      if (
        status === "IN_PROGRESS" &&
        req.assignedToAdminId &&
        req.assignedToAdminId !== adminId
      )
        throw new AppError(t("error.requestAssigned"));
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
  async language(adminId: string, language: Language) {
    if (!["RU", "KZ"].includes(language))
      throw new AppError(t("error.unknownLanguage"));
    return atomic(this.db, async (tx) => {
      await requireAdmin(tx, adminId, "languages", true);
      const admin = await tx.adminUser.update({
        where: { id: adminId },
        data: { language },
      });
      await audit(tx, adminId, "SETTINGS_UPDATED", "AdminUser", adminId, {
        language,
      });
      return admin;
    });
  }
  async translation(
    adminId: string,
    kind: TranslationKind,
    parentId: string,
    language: Language,
  ) {
    return atomic(this.db, async (tx) => {
      await requireAdmin(tx, adminId, entitySection[kind], true);
      return ensureTranslation(tx, kind, parentId, language);
    });
  }
  async deleteTariff(adminId: string, id: string) {
    return atomic(this.db, async (tx) => {
      await requireAdmin(tx, adminId, "tariffs", true);
      const used = await tx.courseTariff.findUniqueOrThrow({
        where: { id },
        include: {
          _count: {
            select: {
              payments: true,
              enrollments: true,
              selectedUsers: true,
              events: true,
            },
          },
        },
      });
      if (Object.values(used._count).some((n) => n > 0)) {
        await tx.courseTariff.update({
          where: { id },
          data: { active: false },
        });
        await audit(tx, adminId, "TARIFF_DISABLED", "CourseTariff", id);
      } else {
        await tx.courseTariff.delete({ where: { id } });
        await audit(tx, adminId, "TARIFF_DELETED", "CourseTariff", id);
      }
      return { courseId: used.courseId };
    });
  }
  async settings() {
    return configSchema.parse(
      (await this.db.setting.findUnique({ where: { key: "admin.settings" } }))
        ?.value ?? defaultSettings,
    );
  }
}
