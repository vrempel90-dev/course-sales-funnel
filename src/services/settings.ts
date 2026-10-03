import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
export const paymentSettingSchema = z
  .object({
    enabled: z.boolean(),
    title: z.string().min(1).max(100),
    instruction: z.string().max(1500),
    requisites: z.string().max(1000),
  })
  .refine(
    (v) => !v.enabled || (v.instruction.trim() && v.requisites.trim()),
    "Заполните инструкцию и реквизиты перед включением",
  );
export const reminderSettingSchema = z.object({
  enabled: z.boolean(),
  demoHours: z.number().min(1).max(720),
  paymentHours: z.number().min(1).max(720),
});
export const botSettingSchema = z.object({
  adminChatId: z
    .string()
    .regex(/^-?\d+$/)
    .or(z.literal("")),
  helpText: z.string().min(1).max(3000),
});
type Store = PrismaClient | Prisma.TransactionClient;
export async function paymentSettings(db: Store, country: "KZ" | "RU") {
  const setting = await db.setting.findUnique({
    where: { key: `payment.${country}` },
  });
  return paymentSettingSchema.parse(
    setting?.value ?? {
      enabled: false,
      title: country === "KZ" ? "Kaspi" : "Банковский перевод",
      instruction: "",
      requisites: "",
    },
  );
}
export async function botSettings(db: Store) {
  const setting = await db.setting.findUnique({ where: { key: "bot" } });
  return botSettingSchema.parse(
    setting?.value ?? {
      adminChatId: process.env.TELEGRAM_ADMIN_CHAT_ID ?? "",
      helpText:
        "Для помощи нажмите «Задать вопрос». Оплата проверяется администратором вручную.",
    },
  );
}
export async function scheduleReminder(
  db: Store,
  userId: string,
  type: "DEMO" | "PAYMENT",
  contextId: string,
) {
  const setting = await db.setting.findUnique({ where: { key: "reminders" } });
  const config = reminderSettingSchema.parse(
    setting?.value ?? { enabled: false, demoHours: 24, paymentHours: 12 },
  );
  if (!config.enabled) return;
  const hours = type === "DEMO" ? config.demoHours : config.paymentHours;
  const dedupeKey = `${type}:${userId}:${contextId}`;
  await db.reminder.upsert({
    where: { dedupeKey },
    update: {},
    create: {
      userId,
      type,
      contextId,
      dedupeKey,
      scheduledAt: new Date(Date.now() + hours * 3600000),
    },
  });
}
