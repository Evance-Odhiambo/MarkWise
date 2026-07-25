"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Users, BookOpen, ClipboardList, ShieldCheck,
  FileText, BarChart3, ArrowRight, UserPlus, AlertTriangle,
} from "lucide-react";
import { useAcademicRegistrar } from "../context";

const BASE = "/admin/academic-registrar/dashboard";

const QUICK_ACTIONS = [
  { label: "Admit Student",      href: `${BASE}/students`,      icon: UserPlus,      color: "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20" },
  { label: "Manage Enrollments", href: `${BASE}/enrollments`,   icon: ClipboardList, color: "bg-sky-500/10 text-sky-600 hover:bg-sky-500/20" },
  { label: "View Transcripts",   href: `${BASE}/transcripts`,   icon: FileText,      color: "bg-violet-500/10 text-violet-600 hover:bg-violet-500/20" },
  { label: "Verify Student",     href: `${BASE}/verification`,  icon: ShieldCheck,   color: "bg-rose-500/10 text-rose-600 hover:bg-rose-500/20" },
  { label: "Generate Reports",   href: `${BASE}/reports`,       icon: BarChart3,     color: "bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20" },
];

export default function RegistryDashboard() {
  const admin = useAcademicRegistrar();
  const [stats, setStats] = useState({ students: 0, courses: 0, enrollments: 0, departments: 0 });
  const [recentStudents, setRecentStudents] = useState<{ id: string; name: string; admissionNumber: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    const [s, d] = await Promise.all([
      fetch(`/api/students?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/departments?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
    ]);
    const students = s.students ?? s.data ?? s ?? [];
    const depts = d.departments ?? d.data ?? d ?? [];
    setStats({ students: students.length, courses: 0, enrollments: 0, departments: depts.length });
    setRecentStudents([...students].sort(() => -1).slice(0, 6));
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const statCards = [
    { label: "Total Students",  value: stats.students,    icon: Users,         color: "text-emerald-600", bg: "bg-emerald-500/10" },
    { label: "Departments",     value: stats.departments, icon: ClipboardList, color: "text-sky-600",     bg: "bg-sky-500/10" },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div className="rounded-2xl bg-gradient-to-br from-purple-900/40 to-slate-900/60 border border-purple-500/20 p-5">
        <p className="text-sm text-purple-300 font-medium">Welcome back,</p>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">{admin?.fullName?.split(" ")[0] ?? "Registrar"} 👋</h1>
        <p className="text-sm text-gray-500 mt-1">Registry Admin · {admin?.institutionName ?? "Institution"}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {statCards.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-4">
            <div className={`flex h-9 w-9 items-center justify-center rounded-xl mb-3 ${s.bg}`}>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </div>
            <div className="text-2xl font-bold text-gray-800">
              {loading ? <span className="inline-block h-6 w-10 rounded bg-gray-200 animate-pulse" /> : s.value}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Quick actions */}
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-2.5">
            {QUICK_ACTIONS.map(a => (
              <Link key={a.href} href={a.href}>
                <span className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${a.color}`}>
                  <a.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{a.label}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent students */}
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Recent Students</h2>
            <Link href={`${BASE}/students`} className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-300">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 rounded-lg bg-gray-200 animate-pulse" />)}</div>
          ) : recentStudents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6">
              <AlertTriangle className="h-6 w-6 text-slate-700" />
              <p className="text-sm text-gray-500">No students registered yet</p>
            </div>
          ) : recentStudents.map((s, i) => (
            <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
              className="flex items-center gap-3 rounded-xl bg-gray-100 px-3 py-2.5 mb-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 text-xs font-bold">
                {s.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-800 truncate">{s.name}</div>
                <div className="text-xs text-gray-400">{s.admissionNumber}</div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
