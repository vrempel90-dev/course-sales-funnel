import { db } from "../../../../database/client";
import { requireAdmin, verifyOrigin } from "../../../../lib/auth";
import { body, errorResponse, json } from "../../../../lib/http";
import { authorize } from "../../../../admin/permissions";
import { listResource } from "../../../../admin/data";
import { mutate } from "../../../../admin/mutations";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ resource: string }> };
export async function GET(request: Request, ctx: Context) {
  try {
    const admin = await requireAdmin();
    const { resource } = await ctx.params;
    authorize(admin.role, resource);
    return json(
      await listResource(db, resource, new URL(request.url).searchParams),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request, ctx: Context) {
  try {
    verifyOrigin(request);
    const admin = await requireAdmin();
    const { resource } = await ctx.params;
    return json(await mutate(db, resource, await body(request), admin));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(request: Request, ctx: Context) {
  try {
    verifyOrigin(request);
    const admin = await requireAdmin();
    const { resource } = await ctx.params;
    return json(await mutate(db, resource, await body(request), admin, true));
  } catch (error) {
    return errorResponse(error);
  }
}
