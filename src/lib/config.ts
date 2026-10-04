import "dotenv/config";
import { z } from "zod";

export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  return z
    .object({
      DATABASE_URL: z.string().min(1),
      TELEGRAM_BOT_TOKEN: z.string().optional(),
      TELEGRAM_BOT_USERNAME: z.string().optional(),
      // Validate OWNER_TELEGRAM_ID during owner bootstrap instead of crashing
      // the whole Railway service at config-parse time. This lets /start
      // respond with the sender's numeric Telegram ID so initial setup is easy.
      OWNER_TELEGRAM_ID: z.string().optional(),
      KASPI_MERCHANT_BIN: z.string().regex(/^\d{12}$/).optional(),
      KASPI_RECEIPT_MAX_AGE_MINUTES: z.coerce
        .number()
        .int()
        .positive()
        .default(1440),
      NODE_ENV: z
        .enum(["development", "production", "test"])
        .default("development"),
      PORT: z.coerce.number().int().min(1).max(65535).default(3000),
      WORKER_INTERVAL_MS: z.coerce
        .number()
        .int()
        .min(100)
        .max(10000)
        .default(1000),
    })
    .parse(
      Object.fromEntries(
        Object.entries(env).filter(([, value]) => value !== ""),
      ),
    );
}
