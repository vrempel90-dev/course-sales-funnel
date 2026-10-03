import { randomBytes } from "node:crypto";
import { AdminConversationState, Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../lib/errors";
import { AdminService, Entity, entitySection } from "./admin";
import { PaymentService } from "./payments";
import { requireAdmin } from "./auth";
import { atomic } from "./transaction";
export type Field = {
  key: string;
  label: string;
  type:
    | "text"
    | "number"
    | "money"
    | "bool"
    | "choice"
    | "category"
    | "course"
    | "cover"
    | "demo";
  options?: string[];
  nullable?: boolean;
  max?: number;
};
const f = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  extra: Partial<Field> = {},
): Field => ({ key, label, type, ...extra });
export const fields: Record<Entity | "reject" | "search", Field[]> = {
  category: [
    f("title", "Название направления"),
    f("description", "Описание (- — пропустить)", "text", {
      nullable: true,
      max: 1000,
    }),
    f("active", "Активность", "bool"),
    f("sortOrder", "Порядок сортировки", "number"),
  ],
  course: [
    f("title", "Название курса"),
    f("shortDescription", "Краткое описание", "text", { max: 300 }),
    f("fullDescription", "Полное описание", "text", { max: 1200 }),
    f("categoryId", "Направление", "category"),
    f("program", "Программа", "text", { max: 1200 }),
    f("duration", "Продолжительность"),
    f("priceKZT", "Цена KZT", "money"),
    f("priceRUB", "Цена RUB", "money"),
    f(
      "cover",
      "Обложка: фото, документ изображения или URL (- — пропустить)",
      "cover",
    ),
    f(
      "demo",
      "Демоурок: видео, документ видео или URL (- — пропустить)",
      "demo",
    ),
    f(
      "telegramChannelId",
      "Channel ID (-100…) или @username (- — пропустить)",
      "text",
      { nullable: true },
    ),
    f("status", "Статус", "choice", {
      options: ["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"],
    }),
    f("sortOrder", "Порядок сортировки", "number"),
  ],
  rule: [
    f("experienceLevel", "Опыт или ANY", "choice", {
      nullable: true,
      options: ["BEGINNER", "PRACTICING", "PROFESSIONAL", "UPSKILLING"],
    }),
    f("categoryId", "Направление или ANY", "category", { nullable: true }),
    f("learningGoal", "Цель или ANY", "choice", {
      nullable: true,
      options: ["NEW_PROFESSION", "NEW_SERVICE", "PERSONAL", "UPSKILLING"],
    }),
    f("courseId", "Курс", "course"),
    f("priority", "Приоритет", "number"),
    f("active", "Активность", "bool"),
  ],
  admin: [
    f("telegramId", "Telegram ID нового сотрудника"),
    f("name", "Имя"),
    f("role", "Роль", "choice", { options: ["ADMIN", "MANAGER"] }),
  ],
  client: [
    f("firstName", "Имя"),
    f("lastName", "Фамилия (- — очистить)", "text", { nullable: true }),
    f("phone", "Телефон (- — очистить)", "text", { nullable: true, max: 40 }),
    f("experienceLevel", "Опыт", "choice", {
      nullable: true,
      options: ["BEGINNER", "PRACTICING", "PROFESSIONAL", "UPSKILLING"],
    }),
    f("categoryId", "Направление", "category", { nullable: true }),
    f("learningGoal", "Цель", "choice", {
      nullable: true,
      options: ["NEW_PROFESSION", "NEW_SERVICE", "PERSONAL", "UPSKILLING"],
    }),
    f("selectedCourseId", "Выбранный курс", "course", { nullable: true }),
    f("currentFunnelStage", "Этап", "choice", {
      options: [
        "NEW",
        "TELEGRAM_STARTED",
        "QUESTIONNAIRE_STARTED",
        "QUESTIONNAIRE_COMPLETED",
        "COURSE_RECOMMENDED",
        "DEMO_VIEWED",
        "COURSE_SELECTED",
        "PAYMENT_STARTED",
        "WAITING_PAYMENT",
        "PAYMENT_REVIEW",
        "PAID",
        "ACCESS_GRANTED",
        "MANAGER_REQUESTED",
      ],
    }),
  ],
  settings: [
    f("projectName", "Название проекта"),
    f("supportUsername", "Support username (- — очистить)"),
    f("adminNotifications", "Уведомления администраторам", "bool"),
    f("remindersEnabled", "Напоминания", "bool"),
    f("demoDelayHours", "Задержка демоурока, часы", "number"),
    f("paymentDelayHours", "Задержка оплаты, часы", "number"),
    f("inviteLifetimeHours", "Срок инвайта, часы (1–168)", "number"),
  ],
  requisites: [
    f("title", "Название способа оплаты"),
    f("instruction", "Инструкция", "text", { max: 1200 }),
    f("requisites", "Реквизиты", "text", { max: 1200 }),
    f("enabled", "Включить способ оплаты", "bool"),
  ],
  reject: [f("reason", "Введите причину отклонения", "text", { max: 1000 })],
  search: [
    f(
      "query",
      "Введите имя, username, Telegram ID или номер телефона.",
      "text",
      { max: 120 },
    ),
  ],
};
export type FlowData = {
  data: Record<string, unknown>;
  id?: string;
  keys: string[];
  previewEdit?: boolean;
  lastUpdateId?: number;
};
export function payload(state: AdminConversationState): FlowData {
  return state.payload as unknown as FlowData;
}
export function fieldFor(state: AdminConversationState) {
  const p = payload(state);
  return fields[state.flowType as keyof typeof fields]?.find(
    (x) => x.key === p.keys[state.step],
  );
}
const json = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
const nonce = () => randomBytes(6).toString("hex");
export class Conversations {
  constructor(public db: PrismaClient) {}
  async state(adminId: string, expected?: string) {
    const state = await this.db.adminConversationState.findUnique({
      where: { adminId },
    });
    if (!state) throw new AppError("Нет активного мастера");
    if (state.expiresAt < new Date()) {
      await this.db.adminConversationState.deleteMany({
        where: { adminId, nonce: state.nonce },
      });
      throw new AppError("Мастер истёк. Откройте его заново.");
    }
    if (expected && state.nonce !== expected)
      throw new AppError("Кнопка устарела. Используйте последнее сообщение.");
    const section =
      state.flowType === "search"
        ? "clients"
        : state.flowType === "reject"
          ? "payments"
          : entitySection[state.flowType as Entity];
    if (!section) throw new AppError("Неизвестный мастер");
    await requireAdmin(this.db, adminId, section, state.flowType !== "search");
    return state;
  }
  async begin(
    adminId: string,
    kind: keyof typeof fields,
    id?: string,
    key?: string,
  ) {
    const section =
      kind === "search"
        ? "clients"
        : kind === "reject"
          ? "payments"
          : entitySection[kind];
    await requireAdmin(this.db, adminId, section, kind !== "search");
    let data: Record<string, unknown> = {
      sortOrder: 0,
      imageFileId: null,
      imageUrl: null,
      demoFileId: null,
      demoVideoUrl: null,
    };
    if (id) {
      let value: unknown;
      switch (kind) {
        case "course":
          value = await this.db.course.findUniqueOrThrow({ where: { id } });
          break;
        case "category":
          value = await this.db.courseCategory.findUniqueOrThrow({
            where: { id },
          });
          break;
        case "rule":
          value = await this.db.recommendationRule.findUniqueOrThrow({
            where: { id },
          });
          break;
        case "client":
          value = await this.db.user.findUniqueOrThrow({ where: { id } });
          break;
        case "settings":
          value = await new AdminService(this.db).settings();
          break;
        case "requisites":
          value = await this.db.paymentMethodSetting.findUniqueOrThrow({
            where: { country: id as "KZ" | "RU" },
          });
          break;
        case "reject":
          await this.db.payment.findUniqueOrThrow({ where: { id } });
          value = {};
          break;
        default:
          throw new AppError("Неверный мастер");
      }
      data = json(value) as Record<string, unknown>;
    }
    const keys = key
      ? [key]
      : fields[kind]
          .filter((x) => kind !== "course" || x.key !== "sortOrder")
          .map((x) => x.key);
    if (keys.some((k) => !fields[kind].some((f) => f.key === k)))
      throw new AppError("Неверное поле");
    return this.db.adminConversationState.upsert({
      where: { adminId },
      update: {
        flowType: kind,
        step: 0,
        nonce: nonce(),
        payload: json({ data, id, keys }),
        expiresAt: new Date(Date.now() + 3600000),
      },
      create: {
        adminId,
        flowType: kind,
        step: 0,
        nonce: nonce(),
        payload: json({ data, id, keys }),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
  }
  async input(
    adminId: string,
    expected: string,
    value: unknown,
    updateId?: number,
  ) {
    const state = await this.state(adminId, expected);
    const field = fieldFor(state);
    if (!field) throw new AppError("Подтвердите результат или отмените мастер");
    let parsed: unknown = value;
    if (field.nullable && (value === "ANY" || value === "-")) parsed = null;
    else if (field.type === "bool") {
      if (!["true", "false"].includes(String(value)))
        throw new AppError("Выберите кнопку");
      parsed = value === "true";
    } else if (field.type === "choice") {
      if (!field.options?.includes(String(value)))
        throw new AppError("Выберите допустимое значение");
    } else if (field.type === "number") {
      if (!/^-?\d{1,6}$/.test(String(value)))
        throw new AppError("Введите целое число");
      parsed = Number(value);
    } else if (field.type === "money") {
      const amount = String(value).trim().replace(",", ".");
      if (!/^\d{1,9}(\.\d{1,2})?$/.test(amount))
        throw new AppError("Введите сумму, не более двух знаков после точки");
      parsed = amount;
    } else if (field.type === "category" || field.type === "course") {
      if (typeof value !== "string" || !/^[a-z0-9-]{1,40}$/.test(value))
        throw new AppError("Выберите запись");
      if (field.type === "category")
        await this.db.courseCategory.findUniqueOrThrow({
          where: { id: value },
        });
      else await this.db.course.findUniqueOrThrow({ where: { id: value } });
    } else if (field.type === "cover" || field.type === "demo") {
      if (typeof value !== "object" || !value)
        throw new AppError("Пришлите файл или URL");
    } else {
      if (typeof value !== "string") throw new AppError("Введите текст");
      parsed = value.trim();
      if (
        String(parsed).length > (field.max ?? 120) ||
        (!parsed && field.key !== "supportUsername")
      )
        throw new AppError(
          "Текст пустой или слишком длинный (до " + (field.max ?? 120) + ")",
        );
      if (field.key === "supportUsername" && parsed === "-") parsed = "";
    }
    const p = payload(state);
    if (field.type === "cover" || field.type === "demo")
      Object.assign(p.data, parsed);
    else p.data[field.key] = parsed;
    const step = p.previewEdit ? p.keys.length : state.step + 1;
    p.previewEdit = false;
    if (updateId !== undefined) p.lastUpdateId = updateId;
    return atomic(this.db, async (tx) => {
      await requireAdmin(
        tx,
        adminId,
        state.flowType === "search"
          ? "clients"
          : state.flowType === "reject"
            ? "payments"
            : entitySection[state.flowType as Entity],
        state.flowType !== "search",
      );
      if (
        !(
          await tx.adminConversationState.updateMany({
            where: { adminId, nonce: expected },
            data: {
              step,
              payload: json(p),
              nonce: nonce(),
              expiresAt: new Date(Date.now() + 3600000),
            },
          })
        ).count
      )
        throw new AppError("Кнопка устарела");
      return tx.adminConversationState.findUniqueOrThrow({
        where: { adminId },
      });
    });
  }
  async editPreview(adminId: string, expected: string, key: string) {
    const state = await this.state(adminId, expected),
      p = payload(state);
    if (state.step !== p.keys.length || !p.keys.includes(key))
      throw new AppError("Изменение недоступно");
    const updated = await this.db.adminConversationState.updateMany({
      where: { adminId, nonce: expected },
      data: {
        step: p.keys.indexOf(key),
        nonce: nonce(),
        payload: json({ ...p, previewEdit: true }),
      },
    });
    if (!updated.count) throw new AppError("Кнопка устарела");
    return this.state(adminId);
  }
  async commit(adminId: string, expected: string) {
    const state = await this.state(adminId, expected),
      p = payload(state);
    if (state.step !== p.keys.length || state.flowType === "search")
      throw new AppError("Мастер не завершён");
    if (state.flowType === "reject")
      return new PaymentService(this.db).review(
        adminId,
        p.id!,
        false,
        String(p.data.reason),
        expected,
      );
    return atomic(this.db, async (tx) => {
      const current = await tx.adminConversationState.findUnique({
        where: { adminId },
      });
      if (
        !current ||
        current.nonce !== expected ||
        current.expiresAt < new Date()
      )
        throw new AppError("Мастер уже завершён");
      const result = await new AdminService(this.db).saveTx(
        tx,
        adminId,
        state.flowType as Entity,
        p.data,
        p.id,
      );
      await tx.adminConversationState.delete({ where: { adminId } });
      return result;
    });
  }
  async cancel(adminId: string) {
    await this.db.adminConversationState.deleteMany({ where: { adminId } });
  }
}
