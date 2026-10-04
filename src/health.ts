import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";
export function healthServer(db: PrismaClient, tokenConfigured: boolean) {
  return createServer(async (req, res) => {
    if (req.method !== "GET" || req.url !== "/health") {
      res.writeHead(404);
      res.end();
      return;
    }
    let connected = true;
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      connected = false;
    }
    res.writeHead(connected ? 200 : 503, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(
      JSON.stringify({
        status: connected ? "ok" : "error",
        database: connected ? "connected" : "unavailable",
        tokenConfigured,
        telegram: tokenConfigured ? "configured" : "not_configured",
        timestamp: new Date().toISOString(),
      }),
    );
  });
}
