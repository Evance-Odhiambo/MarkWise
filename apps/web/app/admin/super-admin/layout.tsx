"use client";
import { ReactNode, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Building2, ShieldCheck,
  BarChart3, Settings2,
  Menu, X, LogOut, ChevronRight, Crown,
} from "lucide-react";
import { SuperAdminContext, type SuperAdminInfo } from "./context";

const BASE = "/admin/super-admin";

const NAV = [
  { label: "Overview",     href: `${BASE}/dashboard`,              icon: LayoutDashboard, color: "text-violet-400" },
  { label: "Institutions",href: `${BASE}/dashboard/institutions`,  icon: Building2,       color: "text-sky-400" },
  { label: "Inst. Admins",href: `${BASE}/dashboard/admins`,        icon: ShieldCheck,     color: "text-indigo-400" },
  { label: "Analytics",   href: `${BASE}/dashboard/analytics`,    icon: BarChart3,       color: "text-blue-400" },
  { label: "Settings",    href: `${BASE}/dashboard/settings`,     icon: Settings2,       color: "text-slate-400" },
];

function SidebarContent({ pathname, onClose }: { pathname: string; onClose?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500 shadow-lg">
            <Crown className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-bold text-white tracking-tight">MarkWise</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV.map(({ label, href, icon: Icon, color }) => {
          const active =
            pathname === href ||
            (href !== `${BASE}/dashboard` && pathname.startsWith(href));
          return (
            <Link key={href} href={href} onClick={onClose}>
              <span
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-slate-400 hover:bg-white/8 hover:text-slate-200"
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? "text-white" : color}`} />
                {label}
                {active && <ChevronRight className="ml-auto h-3.5 w-3.5 text-white/60" />}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-3 py-4">
        <button
          onClick={async () => {
            await fetch("/api/auth/admin/logout", { method: "POST", credentials: "include" });
            window.location.href = "/admin/super-admin/login";
          }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-red-500/15 hover:text-red-400"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign Out
        </button>
      </div>
    </div>
  );
}

const PUBLIC_PATHS_SUPER = [
  "/admin/super-admin/login",
  "/admin/super-admin/register",
  "/admin/super-admin/forgot-password",
  "/admin/super-admin/reset-password",
];

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [admin, setAdmin] = useState<SuperAdminInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isPublicPath = PUBLIC_PATHS_SUPER.some(p => pathname.startsWith(p));

  useEffect(() => {
    if (isPublicPath) { setLoading(false); return; }
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) { router.push("/admin/super-admin/login"); return; }
        setAdmin({
          id: data.id,
          fullName: data.fullName ?? "Admin",
          email: data.email ?? "",
          role: data.role ?? "super_admin",
        });
        setLoading(false);
      })
      .catch(() => router.push("/admin/super-admin/login"));
  }, [router, isPublicPath]);

  if (isPublicPath) return <>{children}</>;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="h-8 w-8 rounded-full border-2 border-violet-500 border-t-transparent"
        />
      </div>
    );
  }

  return (
    <SuperAdminContext.Provider value={admin}>
      <div className="flex h-screen bg-gray-50 text-gray-900 overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-60 shrink-0 flex-col bg-gradient-to-b from-violet-950/60 to-slate-900 border-r border-white/8 overflow-y-auto">
          <SidebarContent pathname={pathname} />
        </aside>

        {/* Mobile drawer */}
        <AnimatePresence>
          {drawerOpen && (
            <>
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/60 lg:hidden"
                onClick={() => setDrawerOpen(false)}
              />
              <motion.aside
                key="drawer"
                initial={{ x: -240 }}
                animate={{ x: 0 }}
                exit={{ x: -240 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="fixed inset-y-0 left-0 z-50 w-60 flex flex-col bg-gradient-to-b from-violet-950/95 to-slate-900 border-r border-white/8 lg:hidden"
              >
                <SidebarContent pathname={pathname} onClose={() => setDrawerOpen(false)} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Main */}
        <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
          {/* Mobile topbar */}
          <header className="flex items-center justify-between px-4 py-3 border-b border-white/8 lg:hidden bg-white/80 backdrop-blur-sm border-gray-200">
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500">
                <Crown className="h-3 w-3 text-white" />
              </div>
              <span className="text-sm font-semibold text-white">MarkWise</span>
            </div>
            <div className="w-8" />
          </header>

          <main className="flex-1 overflow-y-auto bg-white text-gray-900 p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </SuperAdminContext.Provider>
  );
}
