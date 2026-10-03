import { FunnelStage, Prisma } from "@prisma/client";
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
