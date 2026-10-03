import "dotenv/config";
import { z } from "zod";
export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  return z
    .object({
      DATABASE_URL: z.string().min(1),
      TELEGRAM_BOT_TOKEN: z.string().optional(),
      TELEGRAM_BOT_USERNAME: z.string().optional(),
      OWNER_TELEGRAM_ID: z
        .string()
        .regex(/^[1-9]\d{0,15}$/)
        .optional(),
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
