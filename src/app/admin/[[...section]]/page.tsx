import { redirect } from "next/navigation";
import { currentAdmin } from "../../../lib/auth";
import { AdminWorkspace } from "../../../components/admin-workspace";
export const dynamic = "force-dynamic";
export default async function AdminPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const admin = await currentAdmin();
  if (!admin) redirect("/login");
  const { section } = await params;
  return (
    <AdminWorkspace
      key={section?.join("/") || "dashboard"}
      admin={{ id: admin.id, name: admin.name, role: admin.role }}
      section={section?.[0] || "dashboard"}
      detailId={section?.[1]}
    />
  );
}
