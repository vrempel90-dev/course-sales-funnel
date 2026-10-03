import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Update } from "grammy/types";
import { db } from "./database/client";
import { runtimeConfig } from "./lib/config";
import { safeError } from "./lib/errors";
import { createBot } from "./bot";
import { GrammyGateway } from "./bot/gateway";
import { AccessService } from "./services/access";
import { JobService } from "./services/jobs";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const owner = randomUUID();
let running = true;
process.on("SIGINT", () => {
  running = false;
});
process.on("SIGTERM", () => {
  running = false;
});
async function lease() {
  await db.workerLease.upsert({
    where: { id: "bot-worker" },
    update: {},
    create: { id: "bot-worker", owner, expiresAt: new Date(0) },
  });
  return (
    (
      await db.workerLease.updateMany({
        where: {
          id: "bot-worker",
          OR: [{ owner }, { expiresAt: { lt: new Date() } }],
        },
        data: { owner, expiresAt: new Date(Date.now() + 60000) },
      })
    ).count > 0
  );
}
async function main() {
  const config = runtimeConfig();
  if (!config.TELEGRAM_BOT_TOKEN) {
    console.info(
      "Telegram token absent: worker disabled; web admin and database remain available.",
    );
    while (running) await sleep(1000);
    return;
  }
  if (
    config.TELEGRAM_MODE === "webhook" &&
    (!config.TELEGRAM_WEBHOOK_SECRET ||
      config.TELEGRAM_WEBHOOK_SECRET.length < 32 ||
      !config.APP_URL.startsWith("https://"))
  )
    throw new Error(
      "Webhook requires HTTPS APP_URL and TELEGRAM_WEBHOOK_SECRET >=32 characters",
    );
  const bot = createBot(config.TELEGRAM_BOT_TOKEN, db);
  await bot.init();
  const telegram = new GrammyGateway(bot.api);
  const jobs = new JobService(
    db,
    telegram,
    new AccessService(db, telegram, config.INVITE_TTL_HOURS),
  );
  // Renewal runs independently of Telegram calls; loss of the lease stops this process.
  let hasLease = false;
  const heartbeat = setInterval(() => {
    if (hasLease)
      void lease()
        .then((ok) => {
          if (!ok) {
            running = false;
            hasLease = false;
          }
        })
        .catch(() => {
          running = false;
          hasLease = false;
        });
  }, 10000);
  let configured = false;
  try {
    while (running) {
      if (!(await lease())) {
        await sleep(5000);
        continue;
      }
      hasLease = true;
      try {
        if (!configured) {
          if (config.TELEGRAM_MODE === "webhook")
            await bot.api.setWebhook(`${config.APP_URL}/api/telegram/webhook`, {
              secret_token: config.TELEGRAM_WEBHOOK_SECRET,
              allowed_updates: ["message", "callback_query", "chat_member"],
            });
          else await bot.api.deleteWebhook({ drop_pending_updates: false });
          configured = true;
        }
        if (config.TELEGRAM_MODE === "polling") {
          const offset = Number(
            (await db.setting.findUnique({ where: { key: "telegram.offset" } }))
              ?.value ?? 0,
          );
          const updates = await bot.api.getUpdates({
            offset,
            timeout: 1,
            limit: 100,
            allowed_updates: ["message", "callback_query", "chat_member"],
          });
          for (const update of updates)
            await db.$transaction(async (tx) => {
              await tx.telegramUpdate.upsert({
                where: { id: BigInt(update.update_id) },
                update: {},
                create: {
                  id: BigInt(update.update_id),
                  payload: update as unknown as Prisma.InputJsonValue,
                },
              });
              await tx.setting.upsert({
                where: { key: "telegram.offset" },
                update: { value: update.update_id + 1 },
                create: { key: "telegram.offset", value: update.update_id + 1 },
              });
            });
        }
        const updates = await db.telegramUpdate.findMany({
          where: { processedAt: null, attempts: { lt: 5 } },
          orderBy: { id: "asc" },
          take: 50,
        });
        for (const update of updates) {
          if (!running || !hasLease) break;
          try {
            await db.telegramUpdate.update({
              where: { id: update.id },
              data: { attempts: { increment: 1 } },
            });
            await bot.handleUpdate(update.payload as unknown as Update);
            await db.telegramUpdate.update({
              where: { id: update.id },
              data: { processedAt: new Date(), lastError: null },
            });
          } catch (error) {
            await db.telegramUpdate.update({
              where: { id: update.id },
              data: { lastError: safeError(error) },
            });
          }
        }
        if (running && hasLease) await jobs.run();
      } catch (error) {
        console.error("Worker iteration failed:", safeError(error));
        await db.telegramBotError
          .create({ data: { context: "worker", message: safeError(error) } })
          .catch(() => {});
      }
      await sleep(config.WORKER_INTERVAL_MS);
    }
  } finally {
    clearInterval(heartbeat);
    await db.workerLease.deleteMany({ where: { id: "bot-worker", owner } });
  }
}
main()
  .catch((error) => {
    console.error(safeError(error));
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
