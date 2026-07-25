"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Building2, CalendarCheck, BarChart3, AlertTriangle,
  Clock, ArrowRight, CheckCircle2, XCircle,
} from "lucide-react";
import { useFacilitiesManager } from "../context";

const BASE = "/admin/space-admin/dashboard";

const QUICK_ACTIONS = [
  { label: "Manage Rooms",     href: `${BASE}/rooms`,     icon: Building2,   color: "bg-sky-500/10 text-sky-600 hover:bg-sky-500/20" },
  { label: "View Bookings",    href: `${BASE}/bookings`,  icon: CalendarCheck, color: "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20" },
  { label: "Analytics",        href: `${BASE}/analytics`, icon: BarChart3,   color: "bg-violet-500/10 text-violet-600 hover:bg-violet-500/20" },
  { label: "View Conflicts",   href: `${BASE}/conflicts`, icon: AlertTriangle, color: "bg-rose-500/10 text-rose-600 hover:bg-rose-500/20" },
  { label: "Active Holds",     href: `${BASE}/holds`,     icon: Clock,       color: "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20" },
];

const STATUS_COLOR: Record<string, string> = {
  free:        "bg-emerald-500/10 text-emerald-600",
  reserved:    "bg-amber-500/10 text-amber-600",
  occupied:    "bg-sky-500/10 text-sky-600",
  unavailable: "bg-rose-500/10 text-rose-600",
};

interface Analytics {
  todayBookings: number;
  thisWeekBookings: number;
  totalBookings: number;
  cancellationRate: number;
  avgDurationMinutes: number;
  activeHolds: number;
  roomsSummary: { free: number; reserved: number; occupied: number; unavailable: number; total: number };
  topRooms: { roomId: string; roomCode: string; buildingCode: string; name: string; count: number }[];
  bookingsByDay: { date: string; count: number }[];
}

export default function SpaceDashboard() {
  const admin = useFacilitiesManager();
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    const d = await fetch(`/api/bookings/analytics?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any;
    setAnalytics(d ?? null);
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { load(); }, [load]);

  const rooms = analytics?.roomsSummary;

  const statCards = [
    { label: "Rooms",              value: rooms?.total ?? 0,                icon: Building2,   color: "text-sky-600",    bg: "bg-sky-500/10" },
    { label: "Bookings Today",     value: analytics?.todayBookings ?? 0,    icon: CalendarCheck, color: "text-emerald-600", bg: "bg-emerald-500/10" },
    { label: "This Week",          value: analytics?.thisWeekBookings ?? 0, icon: BarChart3,   color: "text-violet-600", bg: "bg-violet-500/10" },
    { label: "Active Holds",       value: analytics?.activeHolds ?? 0,      icon: Clock,       color: "text-amber-600",  bg: "bg-amber-500/10" },
  ];

  // Spark-bar for bookings last 7 days
  const last7 = (analytics?.bookingsByDay ?? []).slice(-7);
  const maxDay = Math.max(...last7.map(d => d.count), 1);

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="rounded-2xl bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 p-5">
        <p className="text-sm text-orange-700 font-medium">Welcome back,</p>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">{admin?.fullName?.split(" ")[0] ?? "Admin"} 👋</h1>
        <p className="text-sm text-gray-500 mt-1">Space Admin · {admin?.institutionName ?? "Institution"}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
        {/* Room status breakdown */}
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Room Status</h2>
          {loading ? (
            <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-8 rounded-lg bg-gray-200 animate-pulse" />)}</div>
          ) : rooms ? (
            <div className="space-y-2">
              {(["free","reserved","occupied","unavailable"] as const).map(s => {
                const val = rooms[s]; const pct = rooms.total > 0 ? Math.round((val / rooms.total) * 100) : 0;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span className={`w-24 shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-medium capitalize ${STATUS_COLOR[s]}`}>{s}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-200">
                      <div className="h-full rounded-full bg-orange-500/70 transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-10 text-right">{val}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No data available</p>
          )}
          <Link href={`${BASE}/rooms`} className="flex items-center gap-1 mt-4 text-xs text-orange-600 hover:text-orange-700">
            Manage rooms <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {/* Bookings last 7 days spark */}
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Bookings — last 7 days</h2>
          {loading ? (
            <div className="h-24 rounded bg-gray-200 animate-pulse" />
          ) : last7.length === 0 ? (
            <p className="text-sm text-gray-500">No booking data</p>
          ) : (
            <div className="flex items-end gap-1.5 h-24">
              {last7.map(d => {
                const h = maxDay > 0 ? Math.max(4, Math.round((d.count / maxDay) * 88)) : 4;
                return (
                  <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-xs text-gray-400">{d.count > 0 ? d.count : ""}</span>
                    <div className="w-full rounded-t-sm bg-orange-500/50 hover:bg-orange-500/80 transition-colors" style={{ height: `${h}px` }} title={`${d.date}: ${d.count}`} />
                    <span className="text-xs text-gray-500 rotate-45 origin-left">
                      {new Date(d.date).toLocaleDateString("en-GB", { weekday: "short" })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <Link href={`${BASE}/bookings`} className="flex items-center gap-1 mt-4 text-xs text-orange-600 hover:text-orange-700">
            View all bookings <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Top rooms + quick actions */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Top Rooms</h2>
            <Link href={`${BASE}/rooms`} className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 rounded-lg bg-gray-200 animate-pulse" />)}</div>
          ) : (analytics?.topRooms ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">No booking data yet</p>
          ) : (analytics?.topRooms ?? []).slice(0, 5).map((r, i) => (
            <motion.div key={r.roomId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}
              className="flex items-center gap-3 rounded-xl bg-gray-100 px-3 py-2.5 mb-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 text-xs font-bold">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-800 truncate">{r.name}</div>
                <div className="text-xs text-gray-400">{r.buildingCode} · {r.roomCode}</div>
              </div>
              <span className="text-xs font-medium text-gray-500">{r.count} bookings</span>
            </motion.div>
          ))}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="space-y-2">
            {QUICK_ACTIONS.map(a => (
              <Link key={a.href} href={a.href}>
                <span className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${a.color}`}>
                  <a.icon className="h-4 w-4 shrink-0" />
                  {a.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
