import { ExperienceLevel, LearningGoal, PrismaClient } from "@prisma/client";
import { AppError } from "../lib/errors";
import { atomic } from "./transaction";
import { event } from "./events";
import { recommend } from "./recommendations";
import { scheduleReminder } from "./settings";
export class WorkflowService {
  constructor(private db: PrismaClient) {}
  async back(userId: string, version: number) {
    return atomic(this.db, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (
        user.questionnaireVersion !== version ||
        !["CATEGORY", "GOAL"].includes(user.conversationStep)
      )
        return user;
      const keepExperience = user.conversationStep === "GOAL";
      const next = await tx.user.update({
        where: { id: userId },
        data: {
          questionnaireVersion: { increment: 1 },
          conversationStep: keepExperience ? "CATEGORY" : "EXPERIENCE",
          experienceLevel: keepExperience ? user.experienceLevel : null,
          categoryId: null,
          learningGoal: null,
        },
      });
      if (keepExperience && user.experienceLevel)
        await tx.questionnaireAnswer.create({
          data: {
            userId,
            questionnaireVersion: next.questionnaireVersion,
            question: "experience",
            answer: user.experienceLevel,
          },
        });
      await event(
        tx,
        userId,
        "questionnaire_back",
        null,
        { version: next.questionnaireVersion },
        "QUESTIONNAIRE_STARTED",
      );
      return next;
    });
  }
  async user(profile: {
    id: number;
    username?: string;
    first_name: string;
    last_name?: string;
  }) {
    return this.db.user.upsert({
      where: { telegramId: BigInt(profile.id) },
      update: {
        telegramUsername: profile.username ?? null,
        firstName: profile.first_name,
        lastName: profile.last_name ?? null,
        lastActivityAt: new Date(),
      },
      create: {
        telegramId: BigInt(profile.id),
        telegramUsername: profile.username,
        firstName: profile.first_name,
        lastName: profile.last_name,
      },
    });
  }
  async start(userId: string) {
    return atomic(this.db, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.currentFunnelStage === "NEW")
        await event(
          tx,
          userId,
          "telegram_started",
          null,
          {},
          "TELEGRAM_STARTED",
        );
      return user;
    });
  }
  async questionnaire(userId: string) {
    return atomic(this.db, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (["EXPERIENCE", "CATEGORY", "GOAL"].includes(user.conversationStep))
        return user;
      const next = await tx.user.update({
        where: { id: userId },
        data: {
          conversationStep: "EXPERIENCE",
          questionnaireVersion: { increment: 1 },
          experienceLevel: null,
          categoryId: null,
          learningGoal: null,
          selectedCourseId: null,
        },
      });
      await event(
        tx,
        userId,
        "questionnaire_started",
        null,
        { version: next.questionnaireVersion },
        "QUESTIONNAIRE_STARTED",
      );
      return next;
    });
  }
  async answer(
    userId: string,
    version: number,
    question: "experience" | "category" | "goal",
    answer: string,
  ) {
    return atomic(this.db, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const expected = {
        experience: "EXPERIENCE",
        category: "CATEGORY",
        goal: "GOAL",
      }[question];
      if (
        user.questionnaireVersion !== version ||
        user.conversationStep !== expected
      )
        return user;
      if (
        question === "experience" &&
        !Object.values(ExperienceLevel).includes(answer as ExperienceLevel)
      )
        throw new AppError("Некорректный ответ");
      if (
        question === "goal" &&
        !Object.values(LearningGoal).includes(answer as LearningGoal)
      )
        throw new AppError("Некорректный ответ");
      if (
        question === "category" &&
        !(await tx.courseCategory.findFirst({
          where: { id: answer, active: true },
        }))
      )
        throw new AppError("Направление больше недоступно");
      await tx.questionnaireAnswer.upsert({
        where: {
          userId_questionnaireVersion_question: {
            userId,
            questionnaireVersion: version,
            question,
          },
        },
        update: {},
        create: { userId, questionnaireVersion: version, question, answer },
      });
      const next = await tx.user.update({
        where: { id: userId },
        data:
          question === "experience"
            ? {
                experienceLevel: answer as ExperienceLevel,
                conversationStep: "CATEGORY",
              }
            : question === "category"
              ? { categoryId: answer, conversationStep: "GOAL" }
              : {
                  learningGoal: answer as LearningGoal,
                  conversationStep: "IDLE",
                },
      });
      await event(tx, userId, "answer_submitted", null, {
        question,
        answer,
        version,
      });
      if (question === "goal") {
        await event(
          tx,
          userId,
          "questionnaire_completed",
          null,
          { version },
          "QUESTIONNAIRE_COMPLETED",
        );
        const ids = await recommend(tx, next);
        if (ids.length)
          await event(
            tx,
            userId,
            "course_recommended",
            null,
            { courseIds: ids, version },
            "COURSE_RECOMMENDED",
          );
      }
      return next;
    });
  }
  async course(
    userId: string,
    courseId: string,
    action: "open" | "demo" | "select",
  ) {
    return atomic(this.db, async (tx) => {
      const course = await tx.course.findFirst({
        where: { id: courseId, status: "ACTIVE", category: { active: true } },
      });
      if (!course) throw new AppError("Курс больше недоступен");
      if (action === "demo" && !course.demoVideoUrl && !course.demoFileId)
        throw new AppError("Демоурок пока не добавлен. Напишите менеджеру.");
      if (action === "select") {
        await tx.user.update({
          where: { id: userId },
          data: { selectedCourseId: courseId, conversationStep: "COUNTRY" },
        });
        await tx.reminder.updateMany({
          where: { userId, type: "DEMO", status: "PENDING" },
          data: { status: "CANCELLED" },
        });
      }
      await event(
        tx,
        userId,
        action === "open"
          ? "course_opened"
          : action === "demo"
            ? "demo_viewed"
            : "course_selected",
        courseId,
        {},
        action === "demo"
          ? "DEMO_VIEWED"
          : action === "select"
            ? "COURSE_SELECTED"
            : undefined,
      );
      if (action === "demo")
        await scheduleReminder(tx, userId, "DEMO", courseId);
      return course;
    });
  }
  async contact(
    userId: string,
    telegramId: number,
    contact: { user_id?: number; phone_number: string },
  ) {
    if (contact.user_id !== telegramId)
      throw new AppError("Используйте кнопку, чтобы поделиться своим номером");
    return this.db.user.update({
      where: { id: userId },
      data: { phone: contact.phone_number.slice(0, 30) },
    });
  }
}
