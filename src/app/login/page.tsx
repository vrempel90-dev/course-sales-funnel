import { currentAdmin } from "../../lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "../../components/login-form";
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await currentAdmin()) redirect("/admin");
  return <LoginForm />;
}
