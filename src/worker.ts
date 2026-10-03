import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Update } from "grammy/types";
import { db } from "./database/client";
import { runtimeConfig } from "./lib/config";
import { safeError, recordError } from "./lib/errors";
import { createBot } from "./bot";
import { bootstrapOwner } from "./services/auth";
import { healthServer } from "./health";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const leaseOwner = randomUUID();
let running = true;
const config = runtimeConfig();
const server = healthServer(db, !!config.TELEGRAM_BOT_TOKEN);
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
    create: { id: "bot-worker", owner: leaseOwner, expiresAt: new Date(0) },
  });
  return (
    (
      await db.workerLease.updateMany({
        where: {
          id: "bot-worker",
          OR: [{ owner: leaseOwner }, { expiresAt: { lt: new Date() } }],
        },
        data: { owner: leaseOwner, expiresAt: new Date(Date.now() + 60000) },
      })
    ).count > 0
  );
}
async function main() {
  await db.$connect();
  await bootstrapOwner(db, config.OWNER_TELEGRAM_ID);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.PORT, "0.0.0.0", resolve);
  });
  if (!config.TELEGRAM_BOT_TOKEN) {
    console.info(
      "Telegram token absent: health server active; Telegram processing disabled.",
    );
    while (running) await sleep(500);
    return;
  }
  if (!config.OWNER_TELEGRAM_ID)
    throw new Error("OWNER_TELEGRAM_ID is required when Telegram is enabled");
  const bot = createBot(
    config.TELEGRAM_BOT_TOKEN,
    db,
    config.TELEGRAM_BOT_USERNAME,
  );
  await bot.init();
  let hasLease = false,
    configured = false;
  const heartbeat = setInterval(() => {
    if (hasLease)
      void lease()
        .then((ok) => {
          if (!ok) {
            running = false;
            process.exitCode = 1;
          }
        })
        .catch(() => {
          running = false;
          process.exitCode = 1;
        });
  }, 10000);
  try {
    while (running) {
      if (!(await lease())) {
        await sleep(1000);
        continue;
      }
      hasLease = true;
      try {
        if (!configured) {
          await bot.api.deleteWebhook({ drop_pending_updates: false });
          await bot.api.setMyCommands([
            { command: "admin", description: "Админ-панель" },
            { command: "cancel", description: "Отменить действие" },
          ]);
          configured = true;
        }
        const offset = Number(
          (await db.setting.findUnique({ where: { key: "telegram.offset" } }))
            ?.value ?? 0,
        );
        const updates = await bot.api.getUpdates({
          offset,
          timeout: 1,
          limit: 100,
          allowed_updates: ["message", "callback_query"],
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
        const pending = await db.telegramUpdate.findMany({
          where: { processedAt: null, attempts: { lt: 5 } },
          orderBy: { id: "asc" },
          take: 50,
        });
        for (const update of pending) {
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
        await db.adminConversationState.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });
      } catch (error) {
        console.error("Worker iteration failed:", safeError(error));
        await recordError(db, error, { section: "worker" });
      }
      await sleep(config.WORKER_INTERVAL_MS);
    }
  } finally {
    clearInterval(heartbeat);
    await db.workerLease.deleteMany({
      where: { id: "bot-worker", owner: leaseOwner },
    });
  }
}
main()
  .catch((error) => {
    console.error(safeError(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await db.$disconnect();
  });
