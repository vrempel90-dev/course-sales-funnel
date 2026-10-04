import { t, content } from "../i18n";
import { Prisma, PrismaClient, Language } from "@prisma/client";
import { AppError } from "../lib/errors";
import { Section } from "../services/auth";
import { pagination } from "../utils/pagination";
export const filters: Partial<Record<Section, string[]>> = {
  clients: ["new", "waiting", "paid", "attention", "RU", "KZ", "all", "search"],
  courses: ["ACTIVE", "HIDDEN", "ARCHIVED", "all"],
  categories: ["all"],
  tariffs: ["active", "disabled", "all"],
  bonuses: ["all"],
  funnel: [
    "WELCOME",
    "PROFESSIONAL",
    "FAMILY",
    "BEAUTY",
    "SALE",
    "REMINDERS",
  ].flatMap((s) => [s + "_RU", s + "_KZ"]),
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
    language: Language = "RU",
  ) {
    const tr = (key: string) => t(key, language);
    if (!filters[section]?.includes(filter))
      throw new AppError(t("error.unknownFilter"));
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
          ...(["RU", "KZ"].includes(filter)
            ? { language: filter as Language }
            : {}),
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
          if (!search?.trim()) throw new AppError(t("error.searchRestart"));
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
              include: { selectedCourse: { include: { translations: true } } },
            }),
          (v) => ({
            id: v.id,
            label:
              clientName(v) +
              " · " +
              v.currentFunnelStage +
              " · " +
              (v.selectedCourse
                ? content(v.selectedCourse.translations, language, "title") ||
                  v.selectedCourse.title
                : "—") +
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
              include: { translations: true },
            }),
          (v) => ({
            id: v.id,
            label:
              (content(v.translations, language, "title") || v.title) +
              " · " +
              tr("value." + v.status),
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
              include: { translations: true },
            }),
          (v) => ({
            id: v.id,
            label:
              (content(v.translations, language, "title") || v.title) +
              " · " +
              tr(v.active ? "common.enabled" : "common.disabled"),
          }),
        );
      case "rules":
        return query(
          this.db.recommendationRule.count(),
          (p) =>
            this.db.recommendationRule.findMany({
              ...p,
              include: { course: { include: { translations: true } } },
              orderBy: [{ priority: "desc" }, { id: "asc" }],
            }),
          (v) => ({
            id: v.id,
            label:
              (content(v.course.translations, language, "title") ||
                v.course.title) +
              " · " +
              tr("field.priority") +
              " " +
              v.priority +
              " · " +
              tr(v.active ? "common.enabled" : "common.disabled"),
          }),
        );
      case "tariffs": {
        const where: Prisma.CourseTariffWhereInput = {
          ...(filter !== "all" ? { active: filter === "active" } : {}),
          ...(userId ? { courseId: userId } : {}),
        };
        return query(
          this.db.courseTariff.count({ where }),
          (p) =>
            this.db.courseTariff.findMany({
              where,
              ...p,
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              include: { translations: true, course: true },
            }),
          (v) => ({
            id: v.id,
            label:
              (content(v.translations, language, "title") || v.code) +
              " · " +
              v.priceKZT +
              " ₸ / " +
              v.priceRUB +
              " ₽ · " +
              v.course.title,
          }),
        );
      }
      case "bonuses":
        return query(
          this.db.bonusMaterial.count(),
          (p) =>
            this.db.bonusMaterial.findMany({
              ...p,
              orderBy,
              include: { translations: true },
            }),
          (v) => ({
            id: v.id,
            label: content(v.translations, language, "title") || v.code,
          }),
        );
      case "funnel": {
        const [stage, lang] = filter.split("_");
        const where = { stage, language: lang as Language };
        return query(
          this.db.funnelContent.count({ where }),
          (p) =>
            this.db.funnelContent.findMany({
              where,
              ...p,
              orderBy: { key: "asc" },
            }),
          (v) => ({
            id: v.id,
            label:
              v.key +
              " · " +
              v.language +
              (v.text ? "" : " · " + tr("common.warningKZ")),
          }),
        );
      }
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
              include: {
                user: true,
                course: { include: { translations: true } },
              },
            }),
          (v) => ({
            id: v.id,
            label:
              clientName(v.user) +
              " · " +
              (content(v.course.translations, language, "title") ||
                v.course.title) +
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
              include: {
                user: true,
                course: { include: { translations: true } },
              },
            }),
          (v) => ({
            id: v.id,
            label:
              clientName(v.user) +
              " · " +
              (content(v.course.translations, language, "title") ||
                v.course.title) +
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
              tr(v.active ? "common.enabled" : "common.disabled"),
          }),
        );
      }
      default:
        throw new AppError(t("error.listUnavailable"));
    }
  }
  async stats(language: Language = "RU") {
    const tr = (key: string) => t(key, language);
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
    const [goals, languages, beauty, payDay, reviewDay, paidDay, reqDay] =
      await Promise.all([
        this.db.user.groupBy({ by: ["primaryGoal"], _count: true }),
        this.db.user.groupBy({ by: ["language"], _count: true }),
        this.db.user.groupBy({ by: ["beautyProfession"], _count: true }),
        this.db.payment.count({ where: { createdAt: { gte: today } } }),
        this.db.payment.count({
          where: { createdAt: { gte: today }, status: "PENDING_REVIEW" },
        }),
        this.db.payment.count({
          where: { reviewedAt: { gte: today }, status: "PAID" },
        }),
        this.db.managerRequest.count({
          where: { createdAt: { gte: today }, status: "NEW" },
        }),
      ]);
    const segments = goals
      .filter((r) => r.primaryGoal)
      .map((r) => tr("value." + r.primaryGoal) + ": " + r._count)
      .concat(
        languages.map((r) => r.language + ": " + r._count),
        beauty
          .filter((r) => r.beautyProfession)
          .map((r) => tr("value." + r.beautyProfession) + ": " + r._count),
      )
      .join("\n");
    return (
      tr("stats.title") +
      "\n" +
      tr("stats.clients") +
      ": " +
      total +
      "\n" +
      tr("stats.today") +
      ": " +
      day +
      "\n" +
      tr("stats.week") +
      ": " +
      week +
      "\n" +
      tr("stats.month") +
      ": " +
      monthly +
      "\n\n" +
      tr("courses.title") +
      " ACTIVE / HIDDEN / ARCHIVED: " +
      ["ACTIVE", "HIDDEN", "ARCHIVED"]
        .map((x) => count(courses, x))
        .join(" / ") +
      "\n" +
      tr("payments.title") +
      " PENDING_REVIEW / PAID / REJECTED: " +
      ["PENDING_REVIEW", "PAID", "REJECTED"]
        .map((x) => count(payments, x))
        .join(" / ") +
      "\n" +
      tr("stats.enrollments") +
      ": " +
      enrollments +
      "\n" +
      tr("stats.waiting") +
      ": " +
      (count(access, "PENDING") + count(access, "CREATING")) +
      "\n" +
      tr("stats.failed") +
      ": " +
      (count(access, "FAILED") + count(access, "UNCERTAIN")) +
      "\n" +
      tr("requests.title") +
      " NEW / IN_PROGRESS: " +
      ["NEW", "IN_PROGRESS"].map((x) => count(requests, x)).join(" / ") +
      "\n" +
      tr("stats.revenueKZT") +
      ": " +
      (revenue.find((x) => x.currency === "KZT")?._sum.amount?.toString() ??
        "0") +
      "\n" +
      tr("stats.revenueRUB") +
      ": " +
      (revenue.find((x) => x.currency === "RUB")?._sum.amount?.toString() ??
        "0") +
      "\n\n" +
      [
        ["stats.paymentsToday", payDay],
        ["stats.reviewToday", reviewDay],
        ["stats.paidToday", paidDay],
        ["stats.requestsToday", reqDay],
      ]
        .map(([k, v]) => tr(String(k)) + ": " + v)
        .join("\n") +
      "\n\n" +
      segments
    );
  }
}
