import { Country, PrismaClient } from "@prisma/client";
import { AppError } from "../lib/errors";
import { atomic } from "./transaction";
import { event } from "./events";
import { paymentSettings, scheduleReminder } from "./settings";
export class PaymentService {
  constructor(private db: PrismaClient) {}
  async create(userId: string, courseId: string, country: Country) {
    return atomic(this.db, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.selectedCourseId !== courseId)
        throw new AppError("Сначала выберите курс");
      const owned = await tx.enrollment.findUnique({
        where: { userId_courseId: { userId, courseId } },
      });
      if (owned)
        throw new AppError(
          "Этот курс уже приобретён. Откройте «Мои курсы» или обратитесь к менеджеру.",
        );
      const course = await tx.course.findFirst({
        where: { id: courseId, status: "ACTIVE", category: { active: true } },
      });
      if (!course) throw new AppError("Курс больше недоступен");
      const settings = await paymentSettings(tx, country);
      if (!settings.enabled)
        throw new AppError(
          "Оплата для этой страны пока не настроена. Напишите менеджеру.",
        );
      const activeKey = `${userId}:${courseId}`;
      let payment = await tx.payment.findUnique({ where: { activeKey } });
      if (
        payment &&
        payment.country !== country &&
        payment.status === "PENDING" &&
        user.conversationStep === "COUNTRY"
      ) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "CANCELLED", activeKey: null },
        });
        payment = null;
      }
      if (!payment) {
        if (user.conversationStep !== "COUNTRY")
          throw new AppError("Откройте выбор страны заново");
        payment = await tx.payment.create({
          data: {
            userId,
            courseId,
            country,
            activeKey,
            currency: country === "KZ" ? "KZT" : "RUB",
            amount: country === "KZ" ? course.priceKZT : course.priceRUB,
            paymentMethod: settings.title,
            instruction: settings.instruction,
            requisites: settings.requisites,
          },
        });
        await event(
          tx,
          userId,
          "payment_started",
          courseId,
          { paymentId: payment.id },
          "PAYMENT_STARTED",
        );
        await scheduleReminder(tx, userId, "PAYMENT", payment.id);
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          activePaymentId: payment.id,
          conversationStep: "IDLE",
          currentFunnelStage:
            payment.status === "PENDING_REVIEW"
              ? "PAYMENT_REVIEW"
              : "WAITING_PAYMENT",
        },
      });
      return payment;
    });
  }
  async waitReceipt(userId: string, paymentId: string) {
    return atomic(this.db, async (tx) => {
      const payment = await tx.payment.findFirst({
        where: {
          id: paymentId,
          userId,
          status: { in: ["PENDING", "REJECTED"] },
        },
      });
      if (!payment) throw new AppError("Оплата уже проверяется или завершена");
      await tx.user.update({
        where: { id: userId },
        data: { activePaymentId: paymentId, conversationStep: "RECEIPT" },
      });
      return payment;
    });
  }
  async receipt(userId: string, fileId: string, type: "photo" | "document") {
    return atomic(this.db, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.conversationStep !== "RECEIPT" || !user.activePaymentId)
        throw new AppError(
          "Нажмите «Я оплатил» у нужного платежа перед отправкой чека",
        );
      const payment = await tx.payment.findFirst({
        where: {
          id: user.activePaymentId,
          userId,
          status: { in: ["PENDING", "REJECTED"] },
        },
      });
      if (!payment) throw new AppError("Этот чек уже отправлен на проверку");
      const existing = await tx.payment.findUnique({
        where: { activeKey: `${userId}:${payment.courseId}` },
      });
      if (existing && existing.id !== payment.id)
        throw new AppError(
          "Для этого курса есть другой активный платёж. Откройте «Мои курсы» или напишите менеджеру.",
          409,
        );
      const next = await tx.payment.update({
        where: { id: payment.id },
        data: {
          receiptFileId: fileId,
          receiptFileType: type,
          receiptRevision: { increment: 1 },
          status: "PENDING_REVIEW",
          activeKey: `${userId}:${payment.courseId}`,
          reviewedAt: null,
          reviewedBy: null,
          rejectionReason: null,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { conversationStep: "IDLE" },
      });
      await event(
        tx,
        userId,
        "payment_receipt_uploaded",
        payment.courseId,
        { paymentId: payment.id, revision: next.receiptRevision },
        "PAYMENT_REVIEW",
      );
      await tx.outboxJob.create({
        data: {
          type: "PAYMENT_REVIEW",
          entityId: payment.id,
          dedupeKey: `receipt:${payment.id}:${next.receiptRevision}`,
        },
      });
      await tx.reminder.updateMany({
        where: {
          userId,
          type: "PAYMENT",
          contextId: payment.id,
          status: "PENDING",
        },
        data: { status: "CANCELLED" },
      });
      return next;
    });
  }
  async review(
    paymentId: string,
    adminId: string,
    approve: boolean,
    reason?: string,
    expectedRevision?: number,
  ) {
    return atomic(this.db, async (tx) => {
      const admin = await tx.adminUser.findFirst({
        where: { id: adminId, active: true, role: "ADMIN" },
      });
      if (!admin) throw new AppError("Недостаточно прав", 403);
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
      });
      if (
        expectedRevision !== undefined &&
        expectedRevision !== payment.receiptRevision
      )
        throw new AppError(
          "Чек изменился. Откройте последнее уведомление или обновите страницу.",
          409,
        );
      if (approve && payment.status === "PAID")
        return tx.enrollment.findUniqueOrThrow({ where: { paymentId } });
      if (!approve && payment.status === "REJECTED") return null;
      if (payment.status !== "PENDING_REVIEW" || !payment.receiptFileId)
        throw new AppError("На проверку должен быть отправлен чек", 409);
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: approve ? "PAID" : "REJECTED",
          activeKey: null,
          reviewedAt: new Date(),
          reviewedBy: adminId,
          rejectionReason: approve
            ? null
            : reason?.trim() || "Оплату пока не удалось подтвердить",
        },
      });
      await tx.auditLog.create({
        data: {
          adminId,
          action: approve ? "PAYMENT_APPROVED" : "PAYMENT_REJECTED",
          entity: "Payment",
          entityId: paymentId,
          metadata: {
            receiptRevision: payment.receiptRevision,
            receiptFileId: payment.receiptFileId,
            reason: reason || "",
            amount: payment.amount.toString(),
            currency: payment.currency,
          },
        },
      });
      await event(
        tx,
        payment.userId,
        approve ? "payment_confirmed" : "payment_rejected",
        payment.courseId,
        { paymentId },
        approve ? "PAID" : undefined,
      );
      if (!approve) {
        await tx.outboxJob.upsert({
          where: {
            dedupeKey: `rejected:${paymentId}:${payment.receiptRevision}`,
          },
          update: {},
          create: {
            type: "PAYMENT_REJECTED",
            entityId: paymentId,
            dedupeKey: `rejected:${paymentId}:${payment.receiptRevision}`,
          },
        });
        return null;
      }
      const enrollment = await tx.enrollment.create({
        data: {
          userId: payment.userId,
          courseId: payment.courseId,
          paymentId,
          status: "ACTIVE",
        },
      });
      await event(tx, payment.userId, "enrollment_created", payment.courseId, {
        enrollmentId: enrollment.id,
      });
      await tx.outboxJob.create({
        data: {
          type: "ACCESS",
          entityId: enrollment.id,
          dedupeKey: `access:${enrollment.id}`,
        },
      });
      await tx.reminder.updateMany({
        where: { userId: payment.userId, status: "PENDING" },
        data: { status: "CANCELLED" },
      });
      return enrollment;
    });
  }
}
