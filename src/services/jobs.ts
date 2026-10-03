import { PrismaClient, OutboxJob } from "@prisma/client";
import { TelegramGateway } from "../bot/gateway";
import { safeError, AppError } from "../lib/errors";
import { AccessService } from "./access";
import { botSettings, reminderSettingSchema } from "./settings";
export class JobService {
  constructor(
    private db: PrismaClient,
    private telegram: TelegramGateway,
    private access: AccessService,
  ) {}
  async run(limit = 20) {
    await this.db.enrollment.updateMany({
      where: {
        accessStatus: "CREATING",
        accessStartedAt: { lt: new Date(Date.now() - 5 * 60000) },
      },
      data: {
        accessStatus: "UNCERTAIN",
        accessError:
          "Процесс прерван во время запроса Telegram. Требуется сверка ссылок.",
      },
    });
    await this.db.outboxJob.updateMany({
      where: {
        status: "RUNNING",
        lockedAt: { lt: new Date(Date.now() - 5 * 60000) },
      },
      data: { status: "PENDING" },
    });
    const reminders = await this.db.reminder.findMany({
      where: { status: "PENDING", scheduledAt: { lte: new Date() } },
      take: limit,
    });
    for (const reminder of reminders)
      await this.db.outboxJob.upsert({
        where: { dedupeKey: `reminder:${reminder.id}` },
        update: {},
        create: {
          type: "REMINDER",
          entityId: reminder.id,
          dedupeKey: `reminder:${reminder.id}`,
        },
      });
    const jobs = await this.db.outboxJob.findMany({
      where: { status: "PENDING", notBefore: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    for (const job of jobs) {
      if (
        !(
          await this.db.outboxJob.updateMany({
            where: { id: job.id, status: "PENDING" },
            data: {
              status: "RUNNING",
              lockedAt: new Date(),
              attempts: { increment: 1 },
            },
          })
        ).count
      )
        continue;
      try {
        await this.deliver(job);
        await this.db.outboxJob.update({
          where: { id: job.id },
          data: { status: "SENT", lastError: null },
        });
      } catch (error) {
        await this.db.outboxJob.update({
          where: { id: job.id },
          data: {
            status: job.attempts >= 4 ? "FAILED" : "PENDING",
            lastError: safeError(error),
            notBefore: new Date(Date.now() + 30000 * 2 ** job.attempts),
          },
        });
        await this.db.telegramBotError.create({
          data: { context: `job:${job.type}`, message: safeError(error) },
        });
      }
    }
  }
  private async adminChat() {
    const settings = await botSettings(this.db);
    const chat = settings.adminChatId || process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (!chat) throw new AppError("Admin notification chat не настроен");
    return chat;
  }
  async deliver(job: Pick<OutboxJob, "type" | "entityId">) {
    if (job.type === "ACCESS") {
      const enrollment = await this.access.grant(job.entityId);
      if (enrollment.accessStatus !== "GRANTED") {
        const full = await this.db.enrollment.findUniqueOrThrow({
          where: { id: job.entityId },
          include: { user: true, course: true },
        });
        await this.telegram.send(
          full.user.telegramId.toString(),
          "Оплата подтверждена ✅ Доступ готовится. Менеджер проверит настройки канала.",
        );
        await this.telegram.send(
          await this.adminChat(),
          `Требуется выдать доступ: ${full.course.title}\nКлиент: ${full.user.firstName}\nОткройте раздел «Доступы» в админке.`,
        );
      }
      return;
    }
    if (job.type === "ACCESS_NOTIFY") {
      const enrollment = await this.db.enrollment.findUniqueOrThrow({
        where: { id: job.entityId },
        include: { user: true, course: true },
      });
      if (enrollment.status !== "ACTIVE" || !enrollment.telegramInviteLink)
        return;
      await this.telegram.send(
        enrollment.user.telegramId.toString(),
        `Оплата подтверждена ✅\nВаш доступ к курсу «${enrollment.course.title}» готов.\nСсылка действует до ${enrollment.inviteExpiresAt?.toISOString()}.`,
        [[{ text: "Перейти к обучению", url: enrollment.telegramInviteLink }]],
      );
      return;
    }
    if (job.type === "PAYMENT_REVIEW" || job.type === "PAYMENT_REJECTED") {
      const payment = await this.db.payment.findUniqueOrThrow({
        where: { id: job.entityId },
        include: { user: true, course: true },
      });
      if (job.type === "PAYMENT_REVIEW") {
        if (payment.status !== "PENDING_REVIEW" || !payment.receiptFileId)
          return;
        await this.telegram.receipt(
          await this.adminChat(),
          payment.receiptFileId,
          payment.receiptFileType ?? "document",
          `Новая оплата на проверку\nКлиент: ${payment.user.firstName}\nTelegram: ${payment.user.telegramUsername ? `@${payment.user.telegramUsername}` : payment.user.telegramId}\nКурс: ${payment.course.title}\nСумма: ${payment.amount} ${payment.currency}`,
          [
            [
              {
                text: "✅ Подтвердить",
                callback_data: `approve:${payment.id}:${payment.receiptRevision}`,
              },
              {
                text: "❌ Отклонить",
                callback_data: `reject:${payment.id}:${payment.receiptRevision}`,
              },
            ],
          ],
        );
      } else {
        if (payment.status !== "REJECTED") return;
        await this.telegram.send(
          payment.user.telegramId.toString(),
          `К сожалению, оплату пока не удалось подтвердить.\n${payment.rejectionReason ?? "Проверьте чек или свяжитесь с менеджером."}`,
          [
            [
              {
                text: "Отправить чек ещё раз",
                callback_data: `receipt:${payment.id}`,
              },
            ],
            [
              {
                text: "Написать менеджеру",
                callback_data: `manager:${payment.courseId}`,
              },
            ],
          ],
        );
      }
      return;
    }
    if (job.type === "MANAGER_NOTIFY") {
      const request = await this.db.managerRequest.findUniqueOrThrow({
        where: { id: job.entityId },
        include: { user: true, course: true },
      });
      await this.telegram.send(
        await this.adminChat(),
        `Новый запрос менеджеру\nКлиент: ${request.user.telegramUsername ? `@${request.user.telegramUsername}` : request.user.telegramId}\nКурс: ${request.course?.title ?? "Не выбран"}\nЭтап: ${request.stage}\n${request.message}`,
      );
      return;
    }
    const reminder = await this.db.reminder.findUniqueOrThrow({
      where: { id: job.entityId },
      include: { user: true },
    });
    if (reminder.status !== "PENDING") return;
    const reminderSetting = await this.db.setting.findUnique({
      where: { key: "reminders" },
    });
    if (
      !reminderSetting ||
      !reminderSettingSchema.parse(reminderSetting.value).enabled
    ) {
      await this.db.reminder.update({
        where: { id: reminder.id },
        data: { status: "CANCELLED" },
      });
      return;
    }
    const eligible =
      reminder.type === "DEMO"
        ? !reminder.user.selectedCourseId &&
          !(await this.db.enrollment.count({
            where: { userId: reminder.userId },
          }))
        : !!(await this.db.payment.findFirst({
            where: { id: reminder.contextId, status: "PENDING" },
          }));
    if (!eligible) {
      await this.db.reminder.update({
        where: { id: reminder.id },
        data: { status: "CANCELLED" },
      });
      return;
    }
    await this.telegram.send(
      reminder.user.telegramId.toString(),
      reminder.type === "DEMO"
        ? "Удалось посмотреть демоурок? Если нужна помощь с выбором, напишите менеджеру."
        : "Если вы уже оплатили обучение, нажмите «Я оплатил» и отправьте чек.",
      [
        [
          { text: "Задать вопрос", callback_data: "manager" },
          { text: "Главное меню", callback_data: "menu" },
        ],
      ],
    );
    await this.db.reminder.update({
      where: { id: reminder.id },
      data: { status: "SENT", sentAt: new Date() },
    });
  }
}
