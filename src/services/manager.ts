import { PrismaClient } from "@prisma/client";
import { AppError } from "../lib/errors";
import { atomic } from "./transaction";
import { event } from "./events";
export class ManagerService {
  constructor(private db: PrismaClient) {}
  async begin(userId: string, courseId?: string) {
    return atomic(this.db, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (
        courseId &&
        !(await tx.course.findUnique({ where: { id: courseId } }))
      )
        throw new AppError("Курс не найден");
      if (user.conversationStep === "MANAGER_MESSAGE") return;
      const selectedCourseId = courseId ?? user.selectedCourseId;
      await tx.user.update({
        where: { id: userId },
        data: {
          resumeStep: user.conversationStep,
          conversationStep: "MANAGER_MESSAGE",
        },
      });
      const request = await tx.managerRequest.create({
        data: {
          userId,
          courseId: selectedCourseId,
          stage: user.currentFunnelStage,
          message: "Клиент запросил связь с менеджером",
        },
      });
      await event(
        tx,
        userId,
        "manager_requested",
        selectedCourseId,
        { requestId: request.id },
        "MANAGER_REQUESTED",
      );
      await tx.outboxJob.create({
        data: {
          type: "MANAGER_NOTIFY",
          entityId: request.id,
          dedupeKey: `manager:${request.id}`,
        },
      });
      return request;
    });
  }
  async message(userId: string, message: string) {
    return atomic(this.db, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.conversationStep !== "MANAGER_MESSAGE")
        throw new AppError("Откройте «Задать вопрос»");
      const request = await tx.managerRequest.findFirst({
        where: { userId, status: "NEW" },
        orderBy: { createdAt: "desc" },
      });
      if (!request) throw new AppError("Запрос не найден");
      await tx.managerRequest.update({
        where: { id: request.id },
        data: { message: message.slice(0, 3000) },
      });
      await tx.user.update({
        where: { id: userId },
        data: { conversationStep: user.resumeStep, resumeStep: "IDLE" },
      });
      await tx.outboxJob.create({
        data: {
          type: "MANAGER_NOTIFY",
          entityId: request.id,
          dedupeKey: `manager-message:${request.id}`,
        },
      });
      return request;
    });
  }
}
