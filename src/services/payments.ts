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
          throw new AppError("Мастер устарел");
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
        throw new AppError(
          "Оплата уже обработана или ещё не передана на проверку",
          409,
        );
      if (!approve && (!reason?.trim() || reason.length > 1000))
        throw new AppError("Укажите причину отклонения");
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
        if (!old)
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
        else if (old.status === "REVOKED" || old.status === "PENDING")
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
          type: approve ? "payment_approved" : "payment_rejected",
          metadata: { paymentId: id },
        },
      });
      return updated;
    });
  }
}
