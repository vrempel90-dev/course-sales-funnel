import "dotenv/config";
import { z } from "zod";
export const runtimeConfig = () =>
  z
    .object({
      DATABASE_URL: z.string().min(1),
      TELEGRAM_MODE: z.enum(["polling", "webhook"]).default("polling"),
      TELEGRAM_BOT_TOKEN: z.string().optional(),
      TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
      APP_URL: z.string().url().default("http://localhost:3000"),
      INVITE_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
      WORKER_INTERVAL_MS: z.coerce.number().int().min(250).default(1000),
    })
    .parse(process.env);
