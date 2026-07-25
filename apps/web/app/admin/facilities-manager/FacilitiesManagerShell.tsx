"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Sparkles, LogOut, Menu, Building2, Calendar, BarChart3, Zap, CalendarClock, X } from "lucide-react";
import { FacilitiesManagerContext, FacilitiesManagerInfo } from "./context";

const NAV_ITEMS = [
  { name: "Rooms",        href: "/admin/facilities-manager",              icon: Building2 },
  { name: "Bookings",     href: "/admin/facilities-manager/bookings",     icon: Calendar  },
  { name: "Reservations", href: "/admin/facilities-manager/reservations", icon: CalendarClock },
  { name: "Analytics",    href: "/admin/facilities-manager/analytics",    icon: BarChart3 },
  { name: "Optimizer",    href: "/admin/facilities-manager/optimizer",    icon: Zap, highlight: true },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex flex-col gap-2 py-8 px-4">
      {NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/admin/facilities-manager" && pathname.startsWith(item.href + "/"));
        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={onNavigate}
            className={`group flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-all mb-1 ${
              item.highlight
                ? "bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-900/30 dark:to-purple-900/20 text-purple-700 dark:text-purple-300 border-l-4 border-purple-500"
                : isActive
                ? "bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-l-4 border-indigo-500"
                : "text-slate-700 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
            }`}
          >
            <item.icon className={`w-5 h-5 flex-shrink-0 ${item.highlight ? "text-purple-500" : isActive ? "text-indigo-600 dark:text-indigo-400" : ""}`} />
            <span>{item.name}</span>
          </Link>
        );
      })}
    </div>
  );
}

function Sidebar({ mobileOpen, onMobileClose }: { mobileOpen: boolean; onMobileClose: () => void }) {
  const pathname = usePathname();

  useEffect(() => { onMobileClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <>
      <aside className="hidden md:flex flex-col w-64 h-screen bg-white dark:bg-slate-800 border-r-2 border-indigo-200 dark:border-indigo-800 shadow-lg fixed top-0 left-0 z-40 overflow-y-auto">
        <NavLinks pathname={pathname} />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden" onClick={onMobileClose} aria-hidden="true" />
      )}
      <aside className={`fixed top-0 left-0 h-dvh w-72 max-w-[85vw] bg-white dark:bg-slate-800 border-r-2 border-indigo-200 dark:border-indigo-800 shadow-xl z-50 transform transition-transform duration-300 ease-in-out md:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between px-4 pt-4">
          <span className="text-lg font-bold text-indigo-700 dark:text-indigo-300">MarkWise</span>
          <button onClick={onMobileClose} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" aria-label="Close menu">
            <X className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          </button>
        </div>
        <NavLinks pathname={pathname} onNavigate={onMobileClose} />
      </aside>
    </>
  );
}

export default function FacilitiesManagerShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const admin = React.useContext(FacilitiesManagerContext);

  const handleSignOut = async () => {
    await fetch("/api/auth/admin/logout", { method: "POST", credentials: "include" });
    router.push("/admin/facilities-manager/login");
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-h-screen ml-0 md:ml-64">
        <header className="bg-white dark:bg-slate-800 border-b-2 border-indigo-200 dark:border-indigo-800 shadow-md sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen((prev) => !prev)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors md:hidden"
                aria-label="Open menu"
              >
                <Menu className="w-6 h-6 text-slate-700 dark:text-slate-200" />
              </button>
              <div className="p-2 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-lg border-2 border-indigo-400 shadow-md relative shrink-0">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white animate-pulse"></div>
              </div>
              <Link href="/" className="text-lg sm:text-xl font-bold text-indigo-800 dark:text-indigo-300 truncate">MarkWise</Link>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>
        <main className="py-4 sm:py-6 flex-1">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            {children}
          </div>
        </main>
        <footer className="border-t-2 border-indigo-200 dark:border-indigo-800 mt-12">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-400 text-center sm:text-left">
                © {new Date().getFullYear()} MarkWise. AI-powered optimization
              </p>
              <div className="flex items-center gap-4">
                <button className="text-xs text-slate-500 hover:text-indigo-600 transition-colors">Settings</button>
                <button className="text-xs text-slate-500 hover:text-indigo-600 transition-colors">Help</button>
                <button className="text-xs text-slate-500 hover:text-indigo-600 transition-colors">API</button>
              </div>
            </div>
          </div>
        </footer>
        <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-20">
          <Link href="/admin/facilities-manager/optimizer" className="group relative">
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-full blur-lg opacity-75 group-hover:opacity-100 transition-opacity"></div>
            <div className="relative bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-3 sm:p-4 rounded-full shadow-lg hover:shadow-xl transition-all border-2 border-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 shrink-0" />
              <span className="max-w-0 group-hover:max-w-xs overflow-hidden transition-all duration-500 whitespace-nowrap text-sm font-medium hidden sm:inline">
                AI Optimizer
              </span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

