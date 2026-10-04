import { t } from "../i18n";
import { PrismaClient } from "@prisma/client";
import { AppError } from "../lib/errors";
import { atomic } from "./transaction";
import { requireAdmin } from "./auth";
import { audit } from "./admin";
export class PaymentService {
  constructor(public db: PrismaClient) {}
  async review(
    adminId: string,
    id: string,
    approve: boolean,
    reason?: string,
    nonce?: string,
  ) {
    return atomic(this.db, async (tx) => {
      await requireAdmin(tx, adminId, "payments", true);
      if (nonce) {
        if (
          !(
            await tx.adminConversationState.deleteMany({
              where: { adminId, nonce, expiresAt: { gt: new Date() } },
            })
          ).count
        )
          throw new AppError(t("error.wizardStale"));
      }
      const payment = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (approve && payment.status === "PAID") return payment;
      if (
        !approve &&
        payment.status === "REJECTED" &&
        payment.rejectionReason === reason
      )
        return payment;
      if (payment.status !== "PENDING_REVIEW")
        throw new AppError(t("error.paymentProcessed"), 409);
      if (!approve && (!reason?.trim() || reason.length > 1000))
        throw new AppError(t("error.rejectReason"));
      if (payment.tariffId) {
        const tariff = await tx.courseTariff.findUniqueOrThrow({
          where: { id: payment.tariffId },
        });
        if (tariff.courseId !== payment.courseId)
          throw new AppError(t("error.paymentTariff"));
      }
      const updated = await tx.payment.update({
        where: { id },
        data: {
          status: approve ? "PAID" : "REJECTED",
          reviewedAt: new Date(),
          reviewedByAdminId: adminId,
          rejectionReason: approve ? null : reason,
          activeKey: null,
        },
      });
      if (approve) {
        const old = await tx.enrollment.findUnique({
          where: {
            userId_courseId: {
              userId: payment.userId,
              courseId: payment.courseId,
            },
          },
        });
        if (!old) {
          await tx.enrollment.create({
            data: {
              userId: payment.userId,
              courseId: payment.courseId,
              paymentId: id,
              tariffId: payment.tariffId,
              status: "ACTIVE",
              accessStatus: "PENDING",
            },
          });
          await tx.funnelEvent.create({
            data: {
              userId: payment.userId,
              courseId: payment.courseId,
              tariffId: payment.tariffId,
              type: "ENROLLMENT_CREATED",
              metadata: { paymentId: id },
            },
          });
        } else if (old.status === "REVOKED" || old.status === "PENDING")
          await tx.enrollment.update({
            where: { id: old.id },
            data: {
              status: "ACTIVE",
              paymentId: id,
              tariffId: payment.tariffId,
              accessStatus: "PENDING",
              accessGrantedAt: null,
              joinedAt: null,
              accessError: null,
            },
          });
        await tx.user.update({
          where: { id: payment.userId },
          data: { currentFunnelStage: "PAID" },
        });
      }
      await audit(
        tx,
        adminId,
        approve ? "PAYMENT_APPROVED" : "PAYMENT_REJECTED",
        "Payment",
        id,
        {
          reason: reason ?? null,
          amount: payment.amount.toString(),
          currency: payment.currency,
        },
      );
      await tx.funnelEvent.create({
        data: {
          userId: payment.userId,
          courseId: payment.courseId,
          tariffId: payment.tariffId,
          type: approve ? "PAYMENT_CONFIRMED" : "PAYMENT_REJECTED",
          metadata: { paymentId: id },
        },
      });
      return updated;
    });
  }
}
