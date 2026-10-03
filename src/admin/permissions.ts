import { Role } from "@prisma/client";
import { AppError } from "../lib/errors";
export const managerResources = [
  "dashboard",
  "clients",
  "courses",
  "payments",
  "requests",
  "funnel",
  "categories",
  "recommendations",
  "lookups",
];
export function authorize(role: Role, resource: string, write = false) {
  if (role === "ADMIN") return;
  if (
    (!write && managerResources.includes(resource)) ||
    (write && ["clients", "requests"].includes(resource))
  )
    return;
  throw new AppError("Недостаточно прав", 403);
}
