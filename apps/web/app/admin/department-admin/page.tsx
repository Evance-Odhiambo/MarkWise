"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DepartmentAdminRoot() {
  const router = useRouter();
  useEffect(() => { router.replace("/admin/department-admin/dashboard"); }, [router]);
  return null;
}
