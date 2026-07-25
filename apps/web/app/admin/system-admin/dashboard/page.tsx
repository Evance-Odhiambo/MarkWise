"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Users, Building2, DoorOpen, GraduationCap,
  AlertTriangle, CheckCircle, Info, BookOpen,
  Bell, ArrowUpRight, ClipboardList, MessageSquare, Calendar,
} from "lucide-react";
import { useSystemAdmin } from "../context";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPIs {
  attendanceRate: number;
  spaceUtilization: number;
  submissionRate: number;
  activeGroups: number;
  materialAccess: number;
  notifReadRate: number;
  totalStudents: number;
  totalLecturers: number;
  totalRooms: number;
  totalDepartments: number;
}

interface DeptStat {
  id: string;
  name: string;
  totalStudents: number;
  attendance: number;
  studyGroups: number;
  submissionRate: number;
  materialAccess: number;
  timetableConflicts: number;
}

interface Building {
  building: string;
  totalRooms: number;
  bookedRooms: number;
  rate: number;
}

interface Alert {
  level: "critical" | "warning" | "info";
  message: string;
}

interface DashboardData {
  kpis: KPIs;
  departments: DeptStat[];
  buildings: Building[];
  alerts: Alert[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusIcon(value: number, good = 80, warn = 65) {
  if (value >= good) return "✅";
  if (value >= warn) return "🟡";
  return "🔴";
}

function statusClass(value: number, good = 80, warn = 65) {
  if (value >= good) return "text-emerald-600";
  if (value >= warn) return "text-amber-600";
  return "text-red-600";
}

function barWidth(value: number) {
  return `${Math.min(100, Math.max(0, value))}%`;
}

const ANALYSIS_PAGES = [
  { label: "Attendance",         href: "attendance",          icon: Users,         color: "from-emerald-500 to-teal-600",  desc: "Rates by department & time patterns" },
  { label: "Space & Rooms",      href: "space",               icon: DoorOpen,      color: "from-blue-500 to-cyan-600",     desc: "Building utilization & conflicts" },
  { label: "Assignments",        href: "assignments",         icon: ClipboardList, color: "from-violet-500 to-purple-600", desc: "Submission & timeliness rates" },
  { label: "Study Groups",       href: "study-groups",        icon: GraduationCap, color: "from-amber-500 to-orange-600",  desc: "Group activity & impact analysis" },
  { label: "Learning Materials", href: "materials",           icon: BookOpen,      color: "from-pink-500 to-rose-600",     desc: "Content access & engagement" },
  { label: "Communications",     href: "communications",      icon: MessageSquare, color: "from-sky-500 to-indigo-600",    desc: "Notifications & session conduct" },
  { label: "Timetable",          href: "timetable-conflicts", icon: Calendar,      color: "from-red-500 to-rose-600",      desc: "Scheduling conflicts & patterns" },
];

const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4 } } };
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } };

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, unit, sub, color,
}: {
  icon: React.ElementType; label: string; value: number | string; unit?: string;
  sub?: string; color: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 hover:border-gray-300 hover:shadow-md transition-all"
    >
      <div className={`absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-10 ${color}`} />
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${color} mb-3`}>
        <Icon className="h-5 w-5 text-gray-900" />
      </div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">
        {value}<span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>
      </p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </motion.div>
  );
}

function BarRow({ label, value, good = 80, warn = 65 }: {
  label: string; value: number; good?: number; warn?: number;
}) {
  const barColor = value >= good ? "bg-emerald-500" : value >= warn ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-32 shrink-0 text-sm text-gray-700 truncate" title={label}>{label}</span>
      <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: barWidth(value) }} />
      </div>
      <span className={`w-10 text-right text-sm font-semibold ${statusClass(value, good, warn)}`}>
        {value}%
      </span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InstitutionDashboardPage() {
  const admin = useSystemAdmin();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const BASE = "/admin/institution-admin/dashboard";

  const fetchData = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/institution/dashboard?institutionId=${admin.institutionId}`,
        { credentials: "include" }
      );
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [admin?.institutionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-96 items-center justify-center text-gray-500">
        Unable to load dashboard data.
      </div>
    );
  }

  const { kpis, departments, buildings, alerts } = data;
  const criticalAlerts = alerts.filter(a => a.level === "critical");
  const warningAlerts  = alerts.filter(a => a.level === "warning");
  const infoAlerts     = alerts.filter(a => a.level === "info");

  return (
    <div className="space-y-8 p-6 bg-gray-50 text-gray-900 min-h-full">

      {/* ── Header ── */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900">Institution Dashboard</h1>
        <p className="text-sm text-gray-500">
          {admin?.institutionName ?? "Institution"} · Operations Overview
        </p>
      </motion.div>

      {/* ── KPI Row ── */}
      <motion.div variants={stagger} initial="hidden" animate="visible">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Institution KPIs</p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <KpiCard icon={Users}         label="Avg Attendance"      value={kpis.attendanceRate}    unit="%" color="bg-emerald-500"  sub={`${kpis.totalStudents.toLocaleString()} students`} />
          <KpiCard icon={DoorOpen}      label="Space Utilization"   value={kpis.spaceUtilization}  unit="%" color="bg-blue-500"     sub={`${kpis.totalRooms} rooms`} />
          <KpiCard icon={ClipboardList} label="Submission Rate"     value={kpis.submissionRate}    unit="%" color="bg-violet-500"   sub="assignment avg" />
          <KpiCard icon={GraduationCap} label="Active Study Groups" value={kpis.activeGroups}           color="bg-amber-500"    sub="past 2 weeks" />
          <KpiCard icon={BookOpen}      label="Material Access"     value={kpis.materialAccess}    unit="%" color="bg-pink-500"     sub="accessing content" />
          <KpiCard icon={Bell}          label="Notif Read Rate"     value={kpis.notifReadRate}     unit="%" color="bg-sky-500"      sub={`${kpis.totalDepartments} depts`} />
        </div>
      </motion.div>

      {/* ── Quick entity counts ── */}
      <motion.div variants={stagger} initial="hidden" animate="visible">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Students",    value: kpis.totalStudents.toLocaleString(),    icon: Users },
            { label: "Lecturers",   value: kpis.totalLecturers.toLocaleString(),   icon: GraduationCap },
            { label: "Rooms",       value: kpis.totalRooms.toLocaleString(),       icon: DoorOpen },
            { label: "Departments", value: kpis.totalDepartments.toLocaleString(), icon: Building2 },
          ].map(item => (
            <motion.div
              key={item.label}
              variants={fadeUp}
              className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center gap-3 hover:shadow-sm transition-shadow"
            >
              <item.icon className="h-5 w-5 text-gray-400 shrink-0" />
              <div>
                <p className="text-lg font-bold text-gray-900 leading-none">{item.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.label}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── Department Health Table ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Department Health Ranking</p>
        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide bg-gray-50">
                  <th className="px-4 py-3 font-semibold">Department</th>
                  <th className="px-4 py-3 font-semibold text-right">Students</th>
                  <th className="px-4 py-3 font-semibold text-right">Attendance</th>
                  <th className="px-4 py-3 font-semibold text-right">Submissions</th>
                  <th className="px-4 py-3 font-semibold text-right">Groups</th>
                  <th className="px-4 py-3 font-semibold text-right">Materials</th>
                  <th className="px-4 py-3 font-semibold text-right">Conflicts</th>
                </tr>
              </thead>
              <tbody>
                {departments.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No department data available</td></tr>
                ) : departments.map((dept, i) => (
                  <tr key={dept.id} className={`border-b border-gray-100 hover:bg-indigo-50/50 transition-colors ${i % 2 === 0 ? "" : "bg-gray-50/60"}`}>
                    <td className="px-4 py-3 font-semibold text-gray-900">{dept.name}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{dept.totalStudents}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${statusClass(dept.attendance)}`}>
                      {dept.attendance}% {statusIcon(dept.attendance)}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${statusClass(dept.submissionRate)}`}>
                      {dept.submissionRate}% {statusIcon(dept.submissionRate)}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${statusClass(dept.studyGroups, 5, 2)}`}>
                      {dept.studyGroups} {statusIcon(dept.studyGroups, 5, 2)}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${statusClass(dept.materialAccess)}`}>
                      {dept.materialAccess}% {statusIcon(dept.materialAccess)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      <span className={dept.timetableConflicts > 20 ? "text-red-600" : dept.timetableConflicts > 10 ? "text-amber-600" : "text-emerald-600"}>
                        {dept.timetableConflicts} {dept.timetableConflicts > 20 ? "🔴" : dept.timetableConflicts > 10 ? "🟡" : "✅"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      {/* ── Trends & Alerts side-by-side ── */}
      <div className="grid lg:grid-cols-2 gap-6">

        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold text-gray-900">Attendance by Department</h3>
          <div className="space-y-1">
            {departments.map(d => (
              <BarRow key={d.id} label={d.name} value={d.attendance} />
            ))}
            {departments.length === 0 && <p className="text-gray-400 text-sm py-4 text-center">No data yet</p>}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200 flex justify-between text-xs text-gray-500">
            <span>Avg: <span className={`font-semibold ${statusClass(kpis.attendanceRate)}`}>{kpis.attendanceRate}%</span></span>
            <span>Target: <span className="text-gray-700 font-semibold">85%</span></span>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
          className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Command Centre</h3>
            <span className="text-xs text-gray-400">{alerts.length} alerts</span>
          </div>
          <div className="space-y-4 overflow-y-auto max-h-64">
            {criticalAlerts.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <span className="text-xs font-semibold text-red-600 uppercase tracking-wide">Critical ({criticalAlerts.length})</span>
                </div>
                <ul className="space-y-1">{criticalAlerts.slice(0, 4).map((a, i) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-red-500 mt-0.5 shrink-0">•</span>{a.message}
                  </li>
                ))}</ul>
              </div>
            )}
            {warningAlerts.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-xs font-semibold text-amber-600 uppercase tracking-wide">Warnings ({warningAlerts.length})</span>
                </div>
                <ul className="space-y-1">{warningAlerts.slice(0, 3).map((a, i) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-amber-500 mt-0.5 shrink-0">•</span>{a.message}
                  </li>
                ))}</ul>
              </div>
            )}
            {infoAlerts.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Info className="h-4 w-4 text-sky-600" />
                  <span className="text-xs font-semibold text-sky-700 uppercase tracking-wide">Info ({infoAlerts.length})</span>
                </div>
                <ul className="space-y-1">{infoAlerts.slice(0, 2).map((a, i) => (
                  <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-sky-500 mt-0.5 shrink-0">•</span>{a.message}
                  </li>
                ))}</ul>
              </div>
            )}
            {alerts.length === 0 && (
              <div className="flex items-center gap-2 py-4">
                <CheckCircle className="h-5 w-5 text-emerald-500" />
                <p className="text-sm text-gray-700">All systems operating normally</p>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Building Utilization ── */}
      {buildings.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Building Utilization — Current Week</p>
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="space-y-1">
              {buildings.map(b => <BarRow key={b.building} label={b.building} value={b.rate} />)}
            </div>
            <p className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-400">
              Active bookings (next 7 days) vs total rooms per building.
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Analysis Cards ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">Deep-Dive Analysis</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {ANALYSIS_PAGES.map(page => (
            <Link key={page.href} href={`${BASE}/${page.href}`}
              className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 hover:border-indigo-300 hover:shadow-md transition-all duration-300">
              <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl opacity-10 group-hover:opacity-20 bg-gradient-to-br ${page.color}`} />
              <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${page.color} mb-3`}>
                <page.icon className="h-5 w-5 text-gray-900" />
              </div>
              <p className="font-semibold text-gray-900 text-sm">{page.label}</p>
              <p className="mt-1 text-xs text-gray-500">{page.desc}</p>
              <ArrowUpRight className="absolute bottom-4 right-4 h-4 w-4 text-gray-400 group-hover:text-indigo-500 transition-colors" />
            </Link>
          ))}
        </div>
      </motion.div>

    </div>
  );
}
