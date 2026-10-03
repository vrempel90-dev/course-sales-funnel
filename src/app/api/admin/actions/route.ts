import { z } from "zod";
import { Api } from "grammy";
import { db } from "../../../../database/client";
import { requireAdmin, verifyOrigin } from "../../../../lib/auth";
import { body, errorResponse, json } from "../../../../lib/http";
import { AppError } from "../../../../lib/errors";
import { authorize } from "../../../../admin/permissions";
import { PaymentService } from "../../../../services/payments";
import { AccessService } from "../../../../services/access";
import { GrammyGateway } from "../../../../bot/gateway";
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const admin = await requireAdmin();
    authorize(admin.role, "actions", true);
    const data = z
      .object({
        action: z.enum([
          "approve",
          "reject",
          "retry",
          "telegram-test",
          "job-retry",
          "update-retry",
        ]),
        id: z.string().optional(),
        reason: z.string().max(1000).optional(),
        reconciled: z.boolean().default(false),
        revision: z.number().int().positive().optional(),
      })
      .parse(await body(request));
    if (data.action === "approve" || data.action === "reject") {
      if (!data.id) throw new AppError("Требуется Payment ID");
      if (!data.revision) throw new AppError("Обновите сведения о чеке");
      return json(
        await new PaymentService(db).review(
          data.id,
          admin.id,
          data.action === "approve",
          data.reason,
          data.revision,
        ),
      );
    }
    if (data.action === "job-retry") {
      const job = await db.outboxJob.findFirst({
        where: { id: data.id, status: "FAILED" },
      });
      if (!job) throw new AppError("Неудачная задача не найдена");
      await db.$transaction([
        db.outboxJob.update({
          where: { id: job.id },
          data: { status: "PENDING", attempts: 0, notBefore: new Date() },
        }),
        db.auditLog.create({
          data: {
            adminId: admin.id,
            action: "JOB_RETRIED",
            entity: "OutboxJob",
            entityId: job.id,
          },
        }),
      ]);
      return json({ ok: true });
    }
    if (data.action === "update-retry") {
      const id = z.string().regex(/^\d+$/).parse(data.id);
      await db.$transaction([
        db.telegramUpdate.update({
          where: { id: BigInt(id) },
          data: { attempts: 0, processedAt: null },
        }),
        db.auditLog.create({
          data: {
            adminId: admin.id,
            action: "UPDATE_RETRIED",
            entity: "TelegramUpdate",
            entityId: id,
          },
        }),
      ]);
      return json({ ok: true });
    }
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new AppError("TELEGRAM_BOT_TOKEN не настроен", 503);
    const telegram = new GrammyGateway(new Api(token));
    if (data.action === "telegram-test") {
      const bot = await telegram.api.getMe();
      return json({
        configured: true,
        connected: true,
        username: bot.username,
      });
    }
    if (!data.id) throw new AppError("Требуется Enrollment ID");
    return json(
      await new AccessService(db, telegram).retry(
        data.id,
        admin.id,
        data.reconciled,
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
