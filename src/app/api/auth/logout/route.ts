import { cookies } from "next/headers";
import { cookieName, logout, verifyOrigin } from "../../../../lib/auth";
import { errorResponse, json } from "../../../../lib/http";
export async function POST(request: Request) {
  try {
    verifyOrigin(request);
    await logout();
    (await cookies()).delete(cookieName);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
