import { t } from "../i18n";
import { PrismaClient } from "@prisma/client";
import { TelegramGateway } from "../bot/gateway";
import { AppError, safeError, recordError } from "../lib/errors";
import { atomic } from "./transaction";
import { requireAdmin } from "./auth";
import { AdminService, audit } from "./admin";
export class AccessService {
  constructor(
    public db: PrismaClient,
    public telegram: TelegramGateway,
  ) {}
  async retry(enrollmentId: string, adminId: string, reconciled = false) {
    const claimed = await atomic(this.db, async (tx) => {
      await requireAdmin(tx, adminId, "access", true);
      const enrollment = await tx.enrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
        include: { course: true, payment: true },
      });
      if (
        enrollment.status !== "ACTIVE" ||
        enrollment.payment.status !== "PAID"
      )
        throw new AppError(t("error.noAccess"));
      if (
        enrollment.accessStatus === "GRANTED" &&
        enrollment.inviteExpiresAt &&
        enrollment.inviteExpiresAt > new Date()
      )
        return null;
      if (
        enrollment.accessStatus === "CREATING" &&
        enrollment.accessStartedAt &&
        enrollment.accessStartedAt.getTime() > Date.now() - 600000
      )
        throw new AppError(t("error.accessRunning"));
      if (
        (enrollment.accessStatus === "CREATING" ||
          enrollment.accessStatus === "UNCERTAIN" ||
          enrollment.accessError?.startsWith("UNCERTAIN:")) &&
        !reconciled
      )
        throw new AppError(t("error.accessReconcile"));
      await tx.enrollment.update({
        where: { id: enrollmentId },
        data: {
          accessStatus: "CREATING",
          accessStartedAt: new Date(),
          accessError: null,
        },
      });
      await audit(tx, adminId, "ACCESS_RETRIED", "Enrollment", enrollmentId, {
        reconciled,
      });
      return enrollment;
    });
    if (!claimed)
      return this.db.enrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
      });
    const settings = await new AdminService(this.db).settings();
    const expiresAt = new Date(
      Date.now() + settings.inviteLifetimeHours * 3600000,
    );
    try {
      if (!claimed.course.telegramChannelId)
        throw new AppError(t("error.noChannel"));
      if (claimed.telegramInviteLink)
        await this.telegram.revokeInvite(
          claimed.course.telegramChannelId,
          claimed.telegramInviteLink,
        );
      const link = await this.telegram.createInvite(
        claimed.course.telegramChannelId,
        "enrollment:" + enrollmentId,
        expiresAt,
      );
      return await atomic(this.db, async (tx) => {
        const updated = await tx.enrollment.update({
          where: { id: enrollmentId },
          data: {
            accessStatus: "GRANTED",
            telegramInviteLink: link,
            inviteExpiresAt: expiresAt,
            accessGrantedAt: new Date(),
            accessError: null,
          },
        });
        await audit(tx, adminId, "ACCESS_GRANTED", "Enrollment", enrollmentId);
        await tx.funnelEvent.create({
          data: {
            userId: claimed.userId,
            courseId: claimed.courseId,
            tariffId: claimed.tariffId,
            type: "ACCESS_GRANTED",
            metadata: { enrollmentId },
          },
        });
        await tx.user.update({
          where: { id: claimed.userId },
          data: { currentFunnelStage: "ACCESS_GRANTED" },
        });
        return updated;
      });
    } catch (error) {
      const uncertain =
        !(error instanceof AppError) &&
        !/\b(?:400|403)\b/.test(safeError(error));
      const message = (uncertain ? "UNCERTAIN: " : "") + safeError(error);
      await recordError(this.db, error, { section: "access", enrollmentId });
      return atomic(this.db, async (tx) => {
        const result = await tx.enrollment.update({
          where: { id: enrollmentId },
          data: { accessStatus: "FAILED", accessError: message },
        });
        await audit(tx, adminId, "ACCESS_FAILED", "Enrollment", enrollmentId, {
          message,
          uncertain,
        });
        await tx.funnelEvent.create({
          data: {
            userId: claimed.userId,
            courseId: claimed.courseId,
            tariffId: claimed.tariffId,
            type: "ACCESS_FAILED",
            metadata: { enrollmentId, uncertain },
          },
        });
        return result;
      });
    }
  }
}
