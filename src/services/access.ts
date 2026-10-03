import { PrismaClient } from "@prisma/client";
import { TelegramGateway } from "../bot/gateway";
import { AppError, safeError } from "../lib/errors";
import { atomic } from "./transaction";
import { event } from "./events";
export class AccessService {
  constructor(
    private db: PrismaClient,
    private telegram: TelegramGateway,
    private ttlHours = 24,
  ) {}
  async grant(enrollmentId: string) {
    const enrollment = await this.db.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      include: { course: true, payment: true },
    });
    if (enrollment.status !== "ACTIVE" || enrollment.payment.status !== "PAID")
      throw new AppError("Нет подтверждённой оплаты");
    if (
      enrollment.accessStatus === "GRANTED" &&
      enrollment.inviteExpiresAt &&
      enrollment.inviteExpiresAt > new Date()
    )
      return enrollment;
    if (["CREATING", "UNCERTAIN"].includes(enrollment.accessStatus))
      return enrollment;
    const claimed = await this.db.enrollment.updateMany({
      where: { id: enrollmentId, accessStatus: { in: ["WAITING", "FAILED"] } },
      data: {
        accessStatus: "CREATING",
        accessStartedAt: new Date(),
        accessError: null,
      },
    });
    if (!claimed.count)
      return this.db.enrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
      });
    let link: string;
    const expiresAt = new Date(Date.now() + this.ttlHours * 3600000);
    try {
      if (!enrollment.course.telegramChannelId)
        throw new AppError("Для курса не задан Telegram Channel ID");
      if (enrollment.telegramInviteLink)
        await this.telegram.revokeInvite(
          enrollment.course.telegramChannelId,
          enrollment.telegramInviteLink,
        );
      link = await this.telegram.createInvite(
        enrollment.course.telegramChannelId,
        `enrollment:${enrollment.id}`,
        expiresAt,
      );
    } catch (error) {
      // A network timeout may occur after Telegram creates the link. Never automatically create another one.
      const uncertain =
        !(error instanceof AppError) &&
        !/\b(?:400|403)\b/.test(safeError(error));
      await atomic(this.db, async (tx) => {
        await tx.enrollment.update({
          where: { id: enrollmentId },
          data: {
            accessStatus: uncertain ? "UNCERTAIN" : "FAILED",
            accessError: safeError(error),
          },
        });
        await event(
          tx,
          enrollment.userId,
          "access_grant_failed",
          enrollment.courseId,
          { enrollmentId, uncertain },
        );
        await tx.telegramBotError.create({
          data: { context: "access", message: safeError(error) },
        });
      });
      return this.db.enrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
      });
    }
    // Persist the link before any notification; delivery retries cannot recreate it.
    return atomic(this.db, async (tx) => {
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
      await event(
        tx,
        enrollment.userId,
        "access_granted",
        enrollment.courseId,
        { enrollmentId },
        "ACCESS_GRANTED",
      );
      await tx.outboxJob.upsert({
        where: {
          dedupeKey: `access-notify:${enrollmentId}:${expiresAt.toISOString()}`,
        },
        update: {},
        create: {
          type: "ACCESS_NOTIFY",
          entityId: enrollmentId,
          dedupeKey: `access-notify:${enrollmentId}:${expiresAt.toISOString()}`,
        },
      });
      return updated;
    });
  }
  async retry(enrollmentId: string, adminId: string, reconciled = false) {
    return atomic(this.db, async (tx) => {
      const admin = await tx.adminUser.findFirst({
        where: { id: adminId, active: true, role: "ADMIN" },
      });
      if (!admin) throw new AppError("Недостаточно прав", 403);
      const enrollment = await tx.enrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
      });
      if (enrollment.accessStatus === "CREATING")
        throw new AppError("Выдача доступа уже выполняется", 409);
      if (enrollment.accessStatus === "UNCERTAIN" && !reconciled)
        throw new AppError(
          "Проверьте ссылки в Telegram и отзовите возможную незаписанную ссылку, затем подтвердите сверку",
          409,
        );
      if (
        enrollment.accessStatus === "GRANTED" &&
        enrollment.inviteExpiresAt &&
        enrollment.inviteExpiresAt > new Date()
      )
        return enrollment;
      await tx.enrollment.update({
        where: { id: enrollmentId },
        data: { accessStatus: "WAITING", accessError: null },
      });
      await tx.outboxJob.upsert({
        where: { dedupeKey: `access:${enrollmentId}` },
        update: { status: "PENDING", attempts: 0, notBefore: new Date() },
        create: {
          type: "ACCESS",
          entityId: enrollmentId,
          dedupeKey: `access:${enrollmentId}`,
        },
      });
      await tx.auditLog.create({
        data: {
          adminId,
          action: "ACCESS_RETRIED",
          entity: "Enrollment",
          entityId: enrollmentId,
          metadata: { reconciled },
        },
      });
      return enrollment;
    });
  }
}
