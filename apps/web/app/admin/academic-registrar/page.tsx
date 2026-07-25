"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RegistryAdminRoot() {
  const router = useRouter();
  useEffect(() => { router.replace("/admin/academic-registrar/dashboard"); }, [router]);
  return null;
}
