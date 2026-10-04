import type { Prisma, PrismaClient } from "@prisma/client";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(?:bot)?\d{5,}:[A-Za-z0-9_-]+/g, "[TOKEN]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[DATABASE_URL]")
    .slice(0, 1000);
}
export async function recordError(
  db: PrismaClient,
  error: unknown,
  context: Prisma.InputJsonObject,
) {
  await db.telegramBotError
    .create({
      data: {
        errorType: error instanceof Error ? error.name : "UNKNOWN",
        message: safeError(error),
        stack:
          error instanceof Error && error.stack ? safeError(error.stack) : null,
        context: JSON.parse(
          JSON.stringify(context, (_key, value) =>
            typeof value === "string" ? safeError(value) : value,
          ),
        ) as Prisma.InputJsonValue,
      },
    })
    .catch((loggingError: unknown) => {
      console.error("Error log failed:", safeError(loggingError));
    });
}
