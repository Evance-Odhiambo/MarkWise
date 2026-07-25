"use client";

import { ReactNode, useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Inter } from "next/font/google";
import "../../globals.css";
import FacilitiesManagerShell from "./FacilitiesManagerShell";
import { FacilitiesManagerContext, type FacilitiesManagerInfo } from "./context";
import { Building2 } from "lucide-react";

const inter = Inter({ subsets: ["latin"] });

const PUBLIC_PATHS = [
  "/admin/facilities-manager/login",
  "/admin/facilities-manager/register",
  "/admin/facilities-manager/forgot-password",
  "/admin/facilities-manager/reset-password",
];

export default function FacilitiesManagerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [admin, setAdmin] = useState<FacilitiesManagerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (isPublicPath) {
      setLoading(false);
      return;
    }
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || data.role !== "facilities_manager") {
          router.push("/admin/facilities-manager/login");
          return;
        }
        setAdmin({
          id: data.id,
          fullName: data.fullName ?? "Admin",
          email: data.email ?? "",
          role: data.role ?? "facilities_manager",
          institutionId: data.institutionId ?? "",
          institutionName: data.institution?.name ?? "Institution",
        });
        setLoading(false);
      })
      .catch(() => router.push("/admin/facilities-manager/login"));
  }, [router, isPublicPath, pathname]);

  if (isPublicPath) {
    return <div className={inter.className}>{children}</div>;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-16 w-16 animate-spin rounded-full border-4 border-gray-200 border-t-sky-600" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Building2 className="h-6 w-6 text-sky-600" />
            </div>
          </div>
          <div className="space-y-2 text-center">
            <p className="text-sm font-medium text-gray-900">Loading Facilities Portal</p>
            <p className="text-xs text-gray-500">Please wait…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={inter.className}>
      <FacilitiesManagerContext.Provider value={admin}>
        <FacilitiesManagerShell>{children}</FacilitiesManagerShell>
      </FacilitiesManagerContext.Provider>
    </div>
  );
}
