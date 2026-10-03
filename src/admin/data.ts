import { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../lib/errors";
import { z } from "zod";
import {
  AccessStatus,
  CourseStatus,
  Currency,
  FunnelStage,
  JobStatus,
  ManagerRequestStatus,
  PaymentStatus,
} from "@prisma/client";
const stages = [
  ["telegram_started", "Telegram start"],
  ["questionnaire_started", "Анкета"],
  ["questionnaire_completed", "Анкета завершена"],
  ["course_recommended", "Рекомендации"],
  ["demo_viewed", "Демо"],
  ["course_selected", "Выбор курса"],
  ["payment_started", "Начали оплату"],
  ["payment_confirmed", "Оплатили"],
  ["access_granted", "Получили доступ"],
];
export async function dashboard(db: PrismaClient) {
  const funnel = [];
  let previous = 0;
  for (const [type, label] of stages) {
    const count = (
      await db.funnelEvent.groupBy({ by: ["userId"], where: { type } })
    ).length;
    funnel.push({
      type,
      label,
      count,
      conversion: previous ? Math.round((count / previous) * 100) : null,
    });
    previous = count;
  }
  const [
    clients,
    newClients,
    pendingReview,
    accessFailed,
    managerRequests,
    revenue,
    recentPayments,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    }),
    db.payment.count({ where: { status: "PENDING_REVIEW" } }),
    db.enrollment.count({
      where: {
        status: "ACTIVE",
        accessStatus: { in: ["WAITING", "FAILED", "UNCERTAIN"] },
      },
    }),
    db.managerRequest.count({
      where: { status: { in: ["NEW", "IN_PROGRESS"] } },
    }),
    db.payment.groupBy({
      by: ["currency"],
      where: { status: "PAID" },
      _sum: { amount: true },
    }),
    db.payment.findMany({
      where: { status: "PENDING_REVIEW" },
      include: { user: true, course: true },
      take: 8,
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    clients,
    newClients,
    pendingReview,
    accessFailed,
    managerRequests,
    revenue,
    funnel,
    recentPayments,
  };
}
export async function clientDetail(db: PrismaClient, id: string) {
  return db.user.findUniqueOrThrow({
    where: { id },
    include: {
      category: true,
      selectedCourse: true,
      answers: { orderBy: { createdAt: "desc" } },
      recommendations: { include: { course: true } },
      payments: { include: { course: true }, orderBy: { createdAt: "desc" } },
      enrollments: { include: { course: true } },
      managerRequests: true,
      events: { orderBy: { createdAt: "desc" }, take: 200 },
    },
  });
}
export async function listResource(
  db: PrismaClient,
  resource: string,
  params: URLSearchParams,
) {
  if (resource === "lookups") {
    const [categories, courses, admins] = await Promise.all([
      db.courseCategory.findMany({
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true },
      }),
      db.course.findMany({
        orderBy: { title: "asc" },
        select: { id: true, title: true },
      }),
      db.adminUser.findMany({
        where: { active: true },
        select: { id: true, name: true },
      }),
    ]);
    return { categories, courses, admins };
  }
  if (resource === "dashboard" || resource === "funnel") return dashboard(db);
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  const take = 25;
  const skip = (page - 1) * take;
  const q = (params.get("q") || "").slice(0, 200);
  const status = params.get("status") || undefined;
  if (status) {
    const enums = {
      clients: FunnelStage,
      payments: PaymentStatus,
      courses: CourseStatus,
      access: AccessStatus,
      requests: ManagerRequestStatus,
      jobs: JobStatus,
    };
    const choices = enums[resource as keyof typeof enums];
    if (choices) z.enum(choices).parse(status);
  }
  const id = params.get("id");
  if (resource === "clients") {
    if (id) return clientDetail(db, id);
    const where: Prisma.UserWhereInput = {
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { telegramUsername: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
            ],
          }
        : {}),
      ...(status
        ? {
            currentFunnelStage:
              status as Prisma.EnumFunnelStageFilter["equals"],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: {
          category: true,
          selectedCourse: true,
          payments: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      db.user.count({ where }),
    ]);
    return { items, total, page };
  }
  if (resource === "payments") {
    if (id) {
      const payment = await db.payment.findUniqueOrThrow({
        where: { id },
        include: {
          user: true,
          course: true,
          reviewer: { select: { name: true } },
          enrollment: true,
        },
      });
      const history = await db.auditLog.findMany({
        where: { entity: "Payment", entityId: id },
        include: { admin: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
      return { ...payment, history };
    }
    const currency = params.get("currency");
    const courseId = params.get("courseId");
    const date = params.get("date");
    if (currency) z.enum(Currency).parse(currency);
    if (date) z.iso.date().parse(date);
    const where: Prisma.PaymentWhereInput = {
      ...(status
        ? { status: status as Prisma.EnumPaymentStatusFilter["equals"] }
        : {}),
      ...(currency
        ? { currency: currency as Prisma.EnumCurrencyFilter["equals"] }
        : {}),
      ...(courseId ? { courseId } : {}),
      ...(date
        ? {
            createdAt: {
              gte: new Date(date),
              lt: new Date(new Date(date).getTime() + 86400000),
            },
          }
        : {}),
      ...(q
        ? {
            user: {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { telegramUsername: { contains: q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.payment.findMany({
        where,
        skip,
        take,
        include: { user: true, course: true },
        orderBy: { createdAt: "desc" },
      }),
      db.payment.count({ where }),
    ]);
    return { items, total, page };
  }
  if (resource === "courses") {
    const where: Prisma.CourseWhereInput = {
      ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
      ...(status
        ? { status: status as Prisma.EnumCourseStatusFilter["equals"] }
        : {}),
    };
    const [items, total] = await Promise.all([
      db.course.findMany({
        where,
        skip,
        take,
        include: { category: true },
        orderBy: { createdAt: "desc" },
      }),
      db.course.count({ where }),
    ]);
    return { items, total, page };
  }
  if (resource === "categories") {
    const [items, total] = await Promise.all([
      db.courseCategory.findMany({ skip, take, orderBy: { sortOrder: "asc" } }),
      db.courseCategory.count(),
    ]);
    return { items, total, page };
  }
  if (resource === "recommendations") {
    const [items, total] = await Promise.all([
      db.recommendationRule.findMany({
        skip,
        take,
        include: { course: true, category: true },
        orderBy: { priority: "desc" },
      }),
      db.recommendationRule.count(),
    ]);
    return { items, total, page };
  }
  if (resource === "access") {
    const where: Prisma.EnrollmentWhereInput = status
      ? { accessStatus: status as Prisma.EnumAccessStatusFilter["equals"] }
      : {};
    const [items, total] = await Promise.all([
      db.enrollment.findMany({
        where,
        skip,
        take,
        include: { user: true, course: true, payment: true },
        orderBy: { createdAt: "desc" },
      }),
      db.enrollment.count({ where }),
    ]);
    return { items, total, page };
  }
  if (resource === "requests") {
    const where: Prisma.ManagerRequestWhereInput = status
      ? { status: status as Prisma.EnumManagerRequestStatusFilter["equals"] }
      : {};
    const [items, total] = await Promise.all([
      db.managerRequest.findMany({
        where,
        skip,
        take,
        include: {
          user: true,
          course: true,
          assignee: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.managerRequest.count({ where }),
    ]);
    return { items, total, page };
  }
  if (resource === "admins") {
    const [items, total] = await Promise.all([
      db.adminUser.findMany({
        skip,
        take,
        select: {
          id: true,
          name: true,
          email: true,
          telegramId: true,
          role: true,
          active: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      db.adminUser.count(),
    ]);
    return { items, total, page };
  }
  if (resource === "audit") {
    const [items, total] = await Promise.all([
      db.auditLog.findMany({
        skip,
        take,
        include: { admin: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      db.auditLog.count(),
    ]);
    return { items, total, page };
  }
  if (resource === "jobs") {
    const [items, total] = await Promise.all([
      db.outboxJob.findMany({
        skip,
        take,
        where: status
          ? { status: status as Prisma.EnumJobStatusFilter["equals"] }
          : {},
        orderBy: { createdAt: "desc" },
      }),
      db.outboxJob.count({
        where: status
          ? { status: status as Prisma.EnumJobStatusFilter["equals"] }
          : {},
      }),
    ]);
    return { items, total, page };
  }
  if (resource === "settings") {
    const [settings, error, heartbeat, updateFailures, jobFailures] =
      await Promise.all([
        db.setting.findMany({
          where: {
            key: { in: ["bot", "payment.KZ", "payment.RU", "reminders"] },
          },
        }),
        db.telegramBotError.findFirst({ orderBy: { createdAt: "desc" } }),
        db.workerLease.findUnique({ where: { id: "bot-worker" } }),
        db.telegramUpdate.count({
          where: { processedAt: null, attempts: { gte: 5 } },
        }),
        db.outboxJob.count({ where: { status: "FAILED" } }),
      ]);
    return {
      settings,
      telegram: {
        configured: !!process.env.TELEGRAM_BOT_TOKEN,
        username: process.env.TELEGRAM_BOT_USERNAME || null,
        adminChat: process.env.TELEGRAM_ADMIN_CHAT_ID || null,
        mode: process.env.TELEGRAM_MODE || "polling",
        connection:
          heartbeat && heartbeat.expiresAt > new Date()
            ? "worker active"
            : "worker offline",
        lastError: error,
        updateFailures,
        jobFailures,
      },
    };
  }
  throw new AppError("Раздел не найден", 404);
}
