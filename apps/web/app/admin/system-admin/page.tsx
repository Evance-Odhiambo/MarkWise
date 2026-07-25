import { redirect } from "next/navigation";

export default function SystemAdminRoot() {
  redirect("/admin/system-admin/dashboard");
}
