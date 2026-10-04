import { FunnelStage, Prisma } from "@prisma/client";
// Vocabulary for the future client flow; no client handlers or jobs are started.
export const funnelEventTypes = [
  "TELEGRAM_STARTED",
  "LANGUAGE_SELECTED",
  "PRIMARY_GOAL_SELECTED",
  "QUALIFICATION_ANSWERED",
  "BONUS_OFFERED",
  "BONUS_VIEWED",
  "COURSES_SHOWN",
  "COURSE_OPENED",
  "TARIFF_SELECTED",
  "CHECKOUT_STARTED",
  "RECEIPT_UPLOADED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_REJECTED",
  "ENROLLMENT_CREATED",
  "ACCESS_GRANTED",
  "ACCESS_FAILED",
  "MANAGER_REQUESTED",
  "TRIAL_REQUESTED",
] as const;
export async function event(
  tx: Prisma.TransactionClient,
  userId: string,
  type: string,
  courseId?: string | null,
  metadata: Prisma.InputJsonValue = {},
  stage?: FunnelStage,
) {
  await tx.funnelEvent.create({ data: { userId, type, courseId, metadata } });
  if (stage)
    await tx.user.update({
      where: { id: userId },
      data: { currentFunnelStage: stage, lastActivityAt: new Date() },
    });
}
