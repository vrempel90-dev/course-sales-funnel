import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../../../../database/client";
import { json, body, errorResponse } from "../../../../lib/http";
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (process.env.TELEGRAM_MODE !== "webhook" || !secret || secret.length < 32)
    return json({ error: "Webhook disabled" }, 503);
  const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (
    Buffer.byteLength(provided) !== Buffer.byteLength(secret) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
  )
    return json({ error: "Unauthorized" }, 401);
  try {
    const update = z
      .object({ update_id: z.number().int().nonnegative() })
      .passthrough()
      .parse(await body(request));
    await db.telegramUpdate.upsert({
      where: { id: BigInt(update.update_id) },
      update: {},
      create: {
        id: BigInt(update.update_id),
        payload: update as Prisma.InputJsonValue,
      },
    });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
