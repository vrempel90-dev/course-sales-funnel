import { PrismaClient, Role } from "@prisma/client";
import { z } from "zod";
import { AppError } from "../lib/errors";
import { hashPassword } from "../lib/password";
import { atomic } from "../services/transaction";
import { authorize } from "./permissions";
import {
  adminSchema,
  categorySchema,
  clientSchema,
  courseSchema,
  requestSchema,
  ruleSchema,
} from "./schemas";
import {
  botSettingSchema,
  paymentSettingSchema,
  reminderSettingSchema,
} from "../services/settings";
export async function mutate(
  db: PrismaClient,
  resource: string,
  input: unknown,
  admin: { id: string; role: Role },
  remove = false,
) {
  authorize(admin.role, resource, true);
  const envelope = z
    .object({ id: z.string().optional(), data: z.unknown().optional() })
    .parse(input);
  const id = envelope.id;
  if (remove && !id) throw new AppError("Требуется id");
  if (
    remove &&
    !["courses", "categories", "recommendations"].includes(resource)
  )
    throw new AppError("Удаление недоступно");
  // Password hashing occurs outside the database transaction.
  const parsedAdmin =
    resource === "admins" ? adminSchema.parse(envelope.data) : null;
  const passwordHash = parsedAdmin?.password
    ? await hashPassword(parsedAdmin.password)
    : undefined;
  return atomic(db, async (tx) => {
    let result: unknown;
    let action = `${resource.toUpperCase()}_${remove ? "DELETED" : id ? "UPDATED" : "CREATED"}`;
    if (resource === "courses") {
      action = remove
        ? "COURSE_ARCHIVED"
        : id
          ? "COURSE_UPDATED"
          : "COURSE_CREATED";
      if (remove)
        result = await tx.course.update({
          where: { id },
          data: { status: "ARCHIVED" },
        });
      else {
        const data = courseSchema.parse(envelope.data);
        result = id
          ? await tx.course.update({ where: { id }, data })
          : await tx.course.create({ data });
      }
    } else if (resource === "categories") {
      if (remove)
        result = await tx.courseCategory.update({
          where: { id },
          data: { active: false },
        });
      else {
        const data = categorySchema.parse(envelope.data);
        result = id
          ? await tx.courseCategory.update({ where: { id }, data })
          : await tx.courseCategory.create({ data });
      }
    } else if (resource === "recommendations") {
      if (remove)
        result = await tx.recommendationRule.delete({ where: { id } });
      else {
        const data = ruleSchema.parse(envelope.data);
        result = id
          ? await tx.recommendationRule.update({ where: { id }, data })
          : await tx.recommendationRule.create({ data });
      }
    } else if (resource === "clients" && id) {
      result = await tx.user.update({
        where: { id },
        data: clientSchema.parse(envelope.data),
      });
    } else if (resource === "requests" && id) {
      const data = requestSchema.parse(envelope.data);
      if (
        data.assignedTo &&
        !(await tx.adminUser.findFirst({
          where: { id: data.assignedTo, active: true },
        }))
      )
        throw new AppError("Выберите активного сотрудника");
      result = await tx.managerRequest.update({ where: { id }, data });
    } else if (resource === "admins" && parsedAdmin) {
      const { password: _password, telegramId, ...rest } = parsedAdmin;
      void _password;
      if (id === admin.id && (!rest.active || rest.role !== "ADMIN"))
        throw new AppError(
          "Нельзя отключить или понизить собственную учётную запись",
        );
      if (id) {
        const previous = await tx.adminUser.findUniqueOrThrow({
          where: { id },
        });
        if (
          previous.active &&
          previous.role === "ADMIN" &&
          (!rest.active || rest.role !== "ADMIN") &&
          (await tx.adminUser.count({
            where: { role: "ADMIN", active: true },
          })) <= 1
        )
          throw new AppError("В системе должен оставаться активный ADMIN");
      } else if (!passwordHash)
        throw new AppError("Укажите пароль минимум 12 символов");
      const data = {
        ...rest,
        telegramId: telegramId ? BigInt(telegramId) : null,
        ...(passwordHash ? { passwordHash } : {}),
      };
      const select = {
        id: true,
        name: true,
        email: true,
        telegramId: true,
        role: true,
        active: true,
      };
      result = id
        ? await tx.adminUser.update({ where: { id }, data, select })
        : await tx.adminUser.create({
            data: { ...data, passwordHash: passwordHash! },
            select,
          });
      if (id && (passwordHash || !rest.active))
        await tx.adminSession.deleteMany({ where: { adminId: id } });
      action = id ? "ADMIN_UPDATED" : "ADMIN_CREATED";
    } else if (resource === "settings") {
      const setting = z
        .object({
          key: z.enum(["bot", "payment.KZ", "payment.RU", "reminders"]),
          value: z.unknown(),
        })
        .parse(envelope.data);
      const value =
        setting.key === "bot"
          ? botSettingSchema.parse(setting.value)
          : setting.key === "reminders"
            ? reminderSettingSchema.parse(setting.value)
            : paymentSettingSchema.parse(setting.value);
      result = await tx.setting.upsert({
        where: { key: setting.key },
        update: { value },
        create: { key: setting.key, value },
      });
      action = "SETTINGS_UPDATED";
    } else throw new AppError("Действие недоступно");
    const entityId =
      id ||
      (result && typeof result === "object" && "id" in result
        ? String(result.id)
        : resource);
    await tx.auditLog.create({
      data: { adminId: admin.id, action, entity: resource, entityId },
    });
    return result;
  });
}
