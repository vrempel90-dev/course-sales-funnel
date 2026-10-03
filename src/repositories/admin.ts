import { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../lib/errors";
import { Section } from "../services/auth";
import { pagination } from "../utils/pagination";
export const filters: Partial<Record<Section, string[]>> = {
  clients: ["new", "waiting", "paid", "attention", "all", "search"],
  courses: ["ACTIVE", "HIDDEN", "ARCHIVED", "all"],
  categories: ["all"],
  rules: ["all"],
  payments: ["PENDING_REVIEW", "PAID", "REJECTED", "all"],
  access: ["FAILED", "PENDING", "GRANTED", "all"],
  requests: ["NEW", "IN_PROGRESS", "RESOLVED", "all"],
  staff: ["active", "disabled", "all"],
};
export type Row = { id: string; label: string };
export function date(value: Date) {
  return value.toLocaleString("ru-RU", { timeZone: "Asia/Almaty" });
}
export function clientName(user: {
  firstName: string;
  lastName: string | null;
  telegramUsername: string | null;
}) {
  return [
    user.firstName,
    user.lastName,
    user.telegramUsername ? "@" + user.telegramUsername : null,
  ]
    .filter(Boolean)
    .join(" ");
}
export class AdminRepository {
  constructor(public db: PrismaClient) {}
  async list(
    section: Section,
    filter: string,
    requested: number,
    userId?: string,
    search?: string,
  ) {
    if (!filters[section]?.includes(filter))
      throw new AppError("Неизвестный фильтр");
    const query = async <T>(
      count: Promise<number>,
      fetch: (p: { skip: number; take: number }) => Promise<T[]>,
      map: (v: T) => Row,
    ) => {
      const p = pagination(await count, requested);
      return {
        ...p,
        rows: (await fetch({ skip: p.skip, take: p.take })).map(map),
      };
    };
    const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
    switch (section) {
      case "clients": {
        const where: Prisma.UserWhereInput = {
          ...(filter === "new" ? { currentFunnelStage: "NEW" } : {}),
          ...(filter === "waiting"
            ? {
                currentFunnelStage: {
                  in: ["PAYMENT_STARTED", "WAITING_PAYMENT", "PAYMENT_REVIEW"],
                },
              }
            : {}),
          ...(filter === "paid"
            ? { payments: { some: { status: "PAID" } } }
            : {}),
          ...(filter === "attention"
            ? {
                OR: [
                  {
                    managerRequests: {
                      some: { status: { in: ["NEW", "IN_PROGRESS"] } },
                    },
                  },
                  {
                    enrollments: {
                      some: { accessStatus: { in: ["FAILED", "UNCERTAIN"] } },
                    },
                  },
                ],
              }
            : {}),
        };
        if (filter === "search") {
          if (!search?.trim())
            throw new AppError("Поиск устарел. Введите запрос заново.");
          const needle = search.trim().replace(/^@/, "");
          where.OR = [
            ...["firstName", "lastName", "telegramUsername", "phone"].map(
              (key) => ({ [key]: { contains: needle, mode: "insensitive" } }),
            ),
            ...(/^[1-9]\d{0,15}$/.test(needle)
              ? [{ telegramId: BigInt(needle) }]
              : []),
          ];
        }
        return query(
          this.db.user.count({ where }),
          (p) =>
            this.db.user.findMany({
              where,
              orderBy,
              ...p,
              include: { selectedCourse: true },
            }),
          (v) => ({
            id: v.id,
            label:
              clientName(v) +
              " · " +
              v.currentFunnelStage +
              " · " +
              (v.selectedCourse?.title ?? "Без курса") +
              " · " +
              date(v.createdAt),
          }),
        );
      }
      case "courses": {
        const where: Prisma.CourseWhereInput =
          filter === "all"
            ? {}
            : { status: filter as "ACTIVE" | "HIDDEN" | "ARCHIVED" };
        if (userId) where.enrollments = { some: { userId } };
        return query(
          this.db.course.count({ where }),
          (p) =>
            this.db.course.findMany({
              where,
              ...p,
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            }),
          (v) => ({
            id: v.id,
            label:
              v.title +
              " · " +
              v.status +
              " · " +
              v.priceKZT +
              " ₸ / " +
              v.priceRUB +
              " ₽",
          }),
        );
      }
      case "categories":
        return query(
          this.db.courseCategory.count(),
          (p) =>
            this.db.courseCategory.findMany({
              ...p,
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            }),
          (v) => ({
            id: v.id,
            label: v.title + " · " + (v.active ? "Включено" : "Выключено"),
          }),
        );
      case "rules":
        return query(
          this.db.recommendationRule.count(),
          (p) =>
            this.db.recommendationRule.findMany({
              ...p,
              include: { course: true },
              orderBy: [{ priority: "desc" }, { id: "asc" }],
            }),
          (v) => ({
            id: v.id,
            label:
              v.course.title +
              " · приоритет " +
              v.priority +
              " · " +
              (v.active ? "Вкл" : "Выкл"),
          }),
        );
      case "payments": {
        const where: Prisma.PaymentWhereInput = {
          ...(filter === "all"
            ? {}
            : { status: filter as "PAID" | "REJECTED" | "PENDING_REVIEW" }),
          ...(userId ? { userId } : {}),
        };
        return query(
          this.db.payment.count({ where }),
          (p) =>
            this.db.payment.findMany({
              where,
              ...p,
              orderBy,
              include: { user: true, course: true },
            }),
          (v) => ({
            id: v.id,
            label:
              clientName(v.user) +
              " · " +
              v.course.title +
              " · " +
              v.amount +
              " " +
              v.currency +
              " · " +
              v.status,
          }),
        );
      }
      case "access": {
        const where: Prisma.EnrollmentWhereInput = {
          ...(filter === "all"
            ? {}
            : {
                accessStatus:
                  filter === "PENDING"
                    ? { in: ["PENDING", "CREATING"] }
                    : filter === "FAILED"
                      ? { in: ["FAILED", "UNCERTAIN"] }
                      : "GRANTED",
              }),
          ...(userId ? { userId } : {}),
        };
        return query(
          this.db.enrollment.count({ where }),
          (p) =>
            this.db.enrollment.findMany({
              where,
              ...p,
              orderBy,
              include: { user: true, course: true },
            }),
          (v) => ({
            id: v.id,
            label:
              clientName(v.user) +
              " · " +
              v.course.title +
              " · " +
              v.accessStatus,
          }),
        );
      }
      case "requests": {
        const where: Prisma.ManagerRequestWhereInput = {
          ...(filter === "all"
            ? {}
            : { status: filter as "NEW" | "IN_PROGRESS" | "RESOLVED" }),
          ...(userId ? { userId } : {}),
        };
        return query(
          this.db.managerRequest.count({ where }),
          (p) =>
            this.db.managerRequest.findMany({
              where,
              ...p,
              orderBy,
              include: { user: true },
            }),
          (v) => ({
            id: v.id,
            label:
              clientName(v.user) + " · " + v.status + " · " + date(v.createdAt),
          }),
        );
      }
      case "staff": {
        const where = filter === "all" ? {} : { active: filter === "active" };
        return query(
          this.db.adminUser.count({ where }),
          (p) => this.db.adminUser.findMany({ where, ...p, orderBy }),
          (v) => ({
            id: v.id,
            label:
              v.name +
              " · " +
              v.role +
              " · " +
              (v.active ? "Активен" : "Отключён"),
          }),
        );
      }
      default:
        throw new AppError("Список недоступен");
    }
  }
  async stats() {
    const shifted = new Date(Date.now() + 5 * 3600000);
    const today = new Date(
      Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate(),
      ) -
        5 * 3600000,
    );
    const month = new Date(
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) -
        5 * 3600000,
    );
    const [
      total,
      day,
      week,
      monthly,
      courses,
      payments,
      enrollments,
      access,
      requests,
      revenue,
    ] = await Promise.all([
      this.db.user.count(),
      this.db.user.count({ where: { createdAt: { gte: today } } }),
      this.db.user.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      }),
      this.db.user.count({ where: { createdAt: { gte: month } } }),
      this.db.course.groupBy({ by: ["status"], _count: true }),
      this.db.payment.groupBy({ by: ["status"], _count: true }),
      this.db.enrollment.count({ where: { status: "ACTIVE" } }),
      this.db.enrollment.groupBy({ by: ["accessStatus"], _count: true }),
      this.db.managerRequest.groupBy({ by: ["status"], _count: true }),
      this.db.payment.groupBy({
        by: ["currency"],
        where: { status: "PAID" },
        _sum: { amount: true },
      }),
    ]);
    const count = (
      rows: { status?: string; accessStatus?: string; _count: number }[],
      key: string,
    ) => rows.find((x) => (x.status ?? x.accessStatus) === key)?._count ?? 0;
    return (
      "📊 Статистика\nКлиенты: " +
      total +
      "\nСегодня: " +
      day +
      "\n7 дней: " +
      week +
      "\nЭтот месяц: " +
      monthly +
      "\n\nКурсы ACTIVE / HIDDEN / ARCHIVED: " +
      ["ACTIVE", "HIDDEN", "ARCHIVED"]
        .map((x) => count(courses, x))
        .join(" / ") +
      "\nОплаты PENDING_REVIEW / PAID / REJECTED: " +
      ["PENDING_REVIEW", "PAID", "REJECTED"]
        .map((x) => count(payments, x))
        .join(" / ") +
      "\nАктивные зачисления: " +
      enrollments +
      "\nОжидают доступа: " +
      (count(access, "PENDING") + count(access, "CREATING")) +
      "\nОшибки доступа: " +
      (count(access, "FAILED") + count(access, "UNCERTAIN")) +
      "\nЗапросы NEW / IN_PROGRESS: " +
      ["NEW", "IN_PROGRESS"].map((x) => count(requests, x)).join(" / ") +
      "\n\nВыручка KZT: " +
      (revenue.find((x) => x.currency === "KZT")?._sum.amount?.toString() ??
        "0") +
      "\nВыручка RUB: " +
      (revenue.find((x) => x.currency === "RUB")?._sum.amount?.toString() ??
        "0")
    );
  }
}
