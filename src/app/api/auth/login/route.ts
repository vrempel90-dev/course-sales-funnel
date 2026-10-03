import { z } from "zod";
import { cookies } from "next/headers";
import { body, errorResponse, json } from "../../../../lib/http";
import { cookieName, login, verifyOrigin } from "../../../../lib/auth";
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    const data = z
      .object({
        email: z.email().transform((value) => value.trim().toLowerCase()),
        password: z.string().min(1).max(200),
      })
      .parse(await body(request));
    const session = await login(data.email, data.password);
    (await cookies()).set(cookieName, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
