import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError, safeError } from "./errors";
export function json(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(data, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    },
  );
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError)
    return json({ error: error.message }, error.status);
  if (error instanceof ZodError)
    return json(
      {
        error: error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      },
      400,
    );
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002")
      return json({ error: "Запись с таким значением уже существует" }, 409);
    if (error.code === "P2025")
      return json({ error: "Запись не найдена" }, 404);
    if (error.code === "P2003")
      return json({ error: "Запись используется другими объектами" }, 409);
  }
  console.error(safeError(error));
  return json(
    { error: "Не удалось выполнить действие. Попробуйте ещё раз." },
    500,
  );
}
export async function body(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 50000)
    throw new AppError("Слишком большой запрос", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("Ожидается JSON");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 50000) throw new AppError("Слишком большой запрос", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("Ожидается JSON");
  }
}
