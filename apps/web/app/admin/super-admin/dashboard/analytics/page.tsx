"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, TrendingUp, Building2, Users2, ShieldCheck } from "lucide-react";

const PRICE_PER_STUDENT_PER_SEMESTER = 199; // KSh

interface Stats {
  institutions: number;
  admins: number;
  lecturers: number;
  students: number;
  rooms: number;
  departments: number;
}

interface Institution {
  id: string;
  name: string;
  _count: { admins: number; lecturers: number; students: number; departments: number };
}

function BarRow({ label, value, max, color, suffix = "" }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-700 truncate max-w-36">{label}</span>
        <span className="text-gray-500 tabular-nums">{value.toLocaleString()}{suffix}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
    </div>
  );
}

export default function PlatformAnalyticsPage() {
  const [stats, setStats]        = useState<Stats | null>(null);
  const [institutions, setInsts] = useState<Institution[]>([]);
  const [loading, setLoading]    = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [sRes, iRes] = await Promise.all([
        fetch("/api/super/stats"),
        fetch("/api/super/institutions"),
      ]);
      if (sRes.ok) setStats(await sRes.json());
      if (iRes.ok) { const d = await iRes.json(); setInsts(d.institutions ?? []); }
    } finally {
      setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const totalUsers = (stats?.students ?? 0) + (stats?.lecturers ?? 0);
  // Estimated platform revenue per semester: students are the billable seat
  const estimatedRevenue = (stats?.students ?? 0) * PRICE_PER_STUDENT_PER_SEMESTER;

  // Sort institutions by active users (students + lecturers) for billing chart
  const byUsers = [...institutions]
    .map(i => ({ ...i, users: i._count.students + i._count.lecturers }))
    .sort((a, b) => b.users - a.users);
  const maxUsers = byUsers[0]?.users ?? 1;

  // Estimated revenue per institution
  const byRevenue = [...institutions]
    .map(i => ({ ...i, rev: i._count.students * PRICE_PER_STUDENT_PER_SEMESTER }))
    .sort((a, b) => b.rev - a.rev);
  const maxRevenue = byRevenue[0]?.rev ?? 1;

  const summaryKpis = [
    { label: "Institutions",       value: stats?.institutions ?? 0, icon: Building2,  color: "text-sky-600",    sub: "SaaS clients" },
    { label: "Institution Admins", value: stats?.admins       ?? 0, icon: ShieldCheck, color: "text-indigo-600", sub: "Admin accounts" },
    { label: "Platform Users",     value: totalUsers,                icon: Users2,     color: "text-violet-600", sub: "Students + lecturers" },
    { label: "Est. Revenue / sem", value: `KSh ${estimatedRevenue.toLocaleString()}`, icon: TrendingUp, color: "text-emerald-600", sub: `@ KSh ${PRICE_PER_STUDENT_PER_SEMESTER}/student`, isText: true },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Platform Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Subscription usage and revenue estimates</p>
        </div>
        <button onClick={load} disabled={loading} className="rounded-xl border border-gray-200 bg-white p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryKpis.map(({ label, value, icon: Icon, color, sub, isText }, i) => (
          <motion.div key={label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-4">
            <Icon className={`h-4 w-4 ${color} mb-3`} />
            <p className={`${isText ? "text-lg" : "text-2xl"} font-bold text-gray-900`}>
              {loading ? "—" : isText ? value : (value as number).toLocaleString()}
            </p>
            <p className="text-xs font-medium text-gray-700 mt-0.5">{label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Platform Users by Institution */}
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Platform Users by Institution</h2>
          <p className="text-xs text-gray-400 mb-4">Students + lecturers — reflects platform adoption</p>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-6 rounded bg-gray-200 animate-pulse" />)}</div>
          ) : byUsers.length === 0 ? (
            <p className="text-xs text-gray-400">No institutions yet</p>
          ) : (
            <div className="space-y-3">
              {byUsers.slice(0, 10).map(inst => (
                <BarRow key={inst.id} label={inst.name} value={inst.users} max={maxUsers} color="bg-violet-500" />
              ))}
            </div>
          )}
        </div>

        {/* Estimated Revenue by Institution */}
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Est. Revenue by Institution</h2>
          <p className="text-xs text-gray-400 mb-4">KSh {PRICE_PER_STUDENT_PER_SEMESTER}/student/semester<br/>(estimated, based on enrolled students)</p>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-6 rounded bg-gray-200 animate-pulse" />)}</div>
          ) : byRevenue.length === 0 ? (
            <p className="text-xs text-gray-400">No institutions yet</p>
          ) : (
            <div className="space-y-3">
              {byRevenue.slice(0, 10).map(inst => (
                <BarRow key={inst.id} label={inst.name} value={inst.rev} max={maxRevenue} color="bg-emerald-500" suffix=" KSh" />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Subscription Table */}
      <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-700">Subscription Summary</h2>
          <p className="text-xs text-gray-400 mt-0.5">One row per onboarded institution</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Institution</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Students</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Lecturers</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Total Users</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Est. Revenue / sem</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-200/50">
                    <td colSpan={5} className="px-4 py-3"><div className="h-4 rounded bg-gray-200 animate-pulse w-2/3" /></td>
                  </tr>
                ))
              ) : institutions.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No institutions onboarded yet.</td></tr>
              ) : (
                institutions.map((inst, i) => (
                  <motion.tr key={inst.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                    className="border-b border-gray-200/50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{inst.name}</td>
                    <td className="px-4 py-3 text-center text-gray-500">{inst._count.students.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center text-gray-500">{inst._count.lecturers}</td>
                    <td className="px-4 py-3 text-center text-gray-500">{(inst._count.students + inst._count.lecturers).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600">
                      KSh {(inst._count.students * PRICE_PER_STUDENT_PER_SEMESTER).toLocaleString()}
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
            {!loading && institutions.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50">
                  <td className="px-4 py-3 text-xs font-semibold text-gray-700">Total</td>
                  <td className="px-4 py-3 text-center text-xs font-semibold text-gray-700">{(stats?.students ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-center text-xs font-semibold text-gray-700">{stats?.lecturers ?? 0}</td>
                  <td className="px-4 py-3 text-center text-xs font-semibold text-gray-700">{totalUsers.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-xs font-bold text-emerald-600">KSh {estimatedRevenue.toLocaleString()}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
