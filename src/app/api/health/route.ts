import { db } from "../../../database/client";
import { json } from "../../../lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return json({
      status: "ok",
      database: "ok",
      telegram: process.env.TELEGRAM_BOT_TOKEN
        ? "configured"
        : "not_configured",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return json(
      {
        status: "error",
        database: "unavailable",
        telegram: process.env.TELEGRAM_BOT_TOKEN
          ? "configured"
          : "not_configured",
        timestamp: new Date().toISOString(),
      },
      503,
    );
  }
}
