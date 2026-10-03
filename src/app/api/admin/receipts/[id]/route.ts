import { Api } from "grammy";
import { db } from "../../../../../database/client";
import { requireAdmin } from "../../../../../lib/auth";
import { errorResponse } from "../../../../../lib/http";
import { AppError } from "../../../../../lib/errors";
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const payment = await db.payment.findUniqueOrThrow({ where: { id } });
    if (!payment.receiptFileId) throw new AppError("Чек ещё не отправлен", 404);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new AppError("Telegram не настроен", 503);
    const file = await new Api(token).getFile(payment.receiptFileId);
    if (
      !file.file_path ||
      !/^[a-zA-Z0-9_./-]+$/.test(file.file_path) ||
      file.file_path.includes("..")
    )
      throw new AppError("Некорректный файл", 502);
    const response = await fetch(
      `https://api.telegram.org/file/bot${token}/${file.file_path}`,
      {
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!response.ok) throw new AppError("Не удалось загрузить чек", 502);
    return new Response(response.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="receipt-${id}.${file.file_path.split(".").at(-1)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
