"use client";
import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// All Tailwind classes must be complete strings so the JIT scanner picks them up.
const THEMES = {
  indigo: {
    bg:         "from-slate-950 via-indigo-950/40 to-slate-950",
    blob1:      "bg-indigo-600/15",
    blob2:      "bg-sky-600/10",
    logoBg:     "from-indigo-500 to-sky-500",
    logoShadow: "shadow-indigo-500/30",
    accent:     "from-indigo-500 via-sky-500 to-cyan-500",
  },
  emerald: {
    bg:         "from-slate-950 via-emerald-950/20 to-slate-950",
    blob1:      "bg-emerald-600/10",
    blob2:      "bg-indigo-600/10",
    logoBg:     "from-emerald-500 to-teal-500",
    logoShadow: "shadow-emerald-500/30",
    accent:     "from-emerald-500 via-teal-500 to-cyan-500",
  },
  blue: {
    bg:         "from-slate-950 via-blue-950/30 to-slate-950",
    blob1:      "bg-blue-600/15",
    blob2:      "bg-cyan-600/10",
    logoBg:     "from-blue-500 to-cyan-500",
    logoShadow: "shadow-blue-500/30",
    accent:     "from-blue-500 via-cyan-500 to-teal-500",
  },
} as const;

export type AuthAccent = keyof typeof THEMES;

interface AuthCardProps {
  accent: AuthAccent;
  icon: LucideIcon;
  children: ReactNode;
}

export function AuthCard({ accent, icon: Icon, children }: AuthCardProps) {
  const t = THEMES[accent];
  return (
    <main className={`min-h-screen bg-gradient-to-br ${t.bg} flex items-center justify-center px-4 py-10`}>
      {/* Ambient blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className={`absolute -top-32 -right-32 h-64 w-64 rounded-full ${t.blob1} blur-3xl`} />
        <div className={`absolute -bottom-32 -left-32 h-64 w-64 rounded-full ${t.blob2} blur-3xl`} />
      </div>

      <div className="relative w-full max-w-md">
        {/* MarkWise logo row */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${t.logoBg} shadow-lg ${t.logoShadow}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
          <span className="text-2xl font-bold text-white tracking-tight">MarkWise</span>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur-sm shadow-2xl overflow-hidden">
          <div className={`h-1 w-full bg-gradient-to-r ${t.accent}`} />
          <div className="p-8">{children}</div>
        </div>

        {/* Back link */}
        <div className="mt-6 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" /> Back to MarkWise Home
          </Link>
        </div>
      </div>
    </main>
  );
}
