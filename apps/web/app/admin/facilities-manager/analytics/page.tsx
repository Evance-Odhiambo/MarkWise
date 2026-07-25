"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  BarChart2, RefreshCw, TrendingUp, Clock, XCircle,
  CheckCircle2, Building2, Users, Zap, AlertTriangle,
  ChevronDown, ChevronUp, ArrowUpDown,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalyticsData = {
  summary: {
    totalBookings: number;
    todayCount: number;
    thisWeekCount: number;
    avgDurationMinutes: number;
    cancellationRate: number;
    activeHoldsCount: number;
    statusCounts: Record<string, number>;
  };
  roomsSummary: { free: number; reserved: number; occupied: number; unavailable: number; total: number };
  bookingsByDay: Array<{ date: string; count: number }>;
  peakHours: Array<{ hour: number; count: number }>;
  topRooms: Array<{ roomId: string; roomCode: string; buildingCode: string; name: string; count: number; totalMinutes: number }>;
  utilizationByRoom: Array<{ roomId: string; roomCode: string; buildingCode: string; name: string; type: string; capacity: number; hoursBooked: number; utilizationPct: number; bookingCount: number }>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60); const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function hourLabel(h: number): string {
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`${color} rounded-2xl p-5 border`}
    >
      <div className="text-3xl font-extrabold tracking-tight">{value}</div>
      <div className="text-sm font-semibold mt-1">{label}</div>
      {sub && <div className="text-xs opacity-70 mt-0.5">{sub}</div>}
    </motion.div>
  );
}

function RoomStatusCard({ label, count, total, color, icon }: { label: string; count: number; total: number; color: string; icon: React.ReactNode }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className={`${color} rounded-xl p-4 border`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold">{count}</div>
      <div className="mt-2 h-1.5 rounded-full bg-black/10 dark:bg-white/10">
        <div className="h-full rounded-full bg-current opacity-50 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs mt-1 opacity-60">{pct}% of {total} rooms</div>
    </div>
  );
}

/** SVG bar chart — bookings over the last 30 days */
function TrendChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const W = 600; const BASELINE = 130; const MAX_H = 100;
  const step = W / Math.max(data.length, 1);
  const barW = Math.max(step * 0.62, 2);
  const pad  = (step - barW) / 2;

  return (
    <svg viewBox={`0 0 ${W} 160`} width="100%" preserveAspectRatio="xMidYMid meet" className="overflow-visible">
      <defs>
        <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#a5b4fc" />
        </linearGradient>
      </defs>
      {/* Gridlines at 33 % / 66 % / 100 % */}
      {[0.33, 0.66, 1].map(f => (
        <line key={f} x1="0" x2={W} y1={BASELINE - f * MAX_H} y2={BASELINE - f * MAX_H}
          stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 3" />
      ))}
      <line x1="0" x2={W} y1={BASELINE} y2={BASELINE} stroke="#cbd5e1" strokeWidth="1" />
      {/* Bars */}
      {data.map((d, i) => {
        const h = Math.max((d.count / maxCount) * MAX_H, d.count > 0 ? 2 : 0);
        const x = i * step + pad;
        return (
          <g key={d.date}>
            <rect x={x} y={BASELINE - h} width={barW} height={h} fill="url(#grad)" rx="2" opacity="0.9" />
            <title>{`${new Date(d.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${d.count} booking${d.count !== 1 ? "s" : ""}`}</title>
          </g>
        );
      })}
      {/* Date labels every 5 days + last day */}
      {data.map((d, i) => {
        if (i % 5 !== 0 && i !== data.length - 1) return null;
        const label = new Date(d.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
        return <text key={d.date} x={i * step + step / 2} y="152" textAnchor="middle" fontSize="9" fill="#94a3b8">{label}</text>;
      })}
      {/* Y label — max value */}
      <text x="4" y={BASELINE - MAX_H + 4} fontSize="9" fill="#94a3b8">{maxCount}</text>
    </svg>
  );
}

/** Horizontal bar chart for peak hours */
function PeakHoursChart({ data }: { data: Array<{ hour: number; count: number }> }) {
  const relevant = data.filter(d => d.hour >= 6 && d.hour <= 22);
  const maxCount = Math.max(...relevant.map(d => d.count), 1);
  return (
    <div className="space-y-1.5">
      {relevant.map(d => {
        const pct = (d.count / maxCount) * 100;
        const intensity = pct > 66 ? "from-rose-500 to-rose-400" : pct > 33 ? "from-amber-500 to-amber-400" : "from-indigo-500 to-indigo-400";
        return (
          <div key={d.hour} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 w-9 text-right flex-shrink-0">{hourLabel(d.hour)}</span>
            <div className="flex-1 h-4 bg-slate-100 dark:bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${intensity} rounded-full transition-all duration-700`}
                style={{ width: `${Math.max(pct, 1)}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500 w-6 flex-shrink-0">{d.count}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type SortKey = "utilizationPct" | "hoursBooked" | "bookingCount";
type SortDir = "asc" | "desc";

export default function AnalyticsPage() {
  const router = useRouter();

  const [institutionId, setInstitutionId]   = useState<string | null>(null);
  const [data, setData]                     = useState<AnalyticsData | null>(null);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);
  const [lastUpdated, setLastUpdated]       = useState<Date | null>(null);
  const [sortKey, setSortKey]               = useState<SortKey>("utilizationPct");
  const [sortDir, setSortDir]               = useState<SortDir>("desc");

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.institutionId) { router.push("/admin/facilities-manager/login"); return; }
        setInstitutionId(data.institutionId);
      })
      .catch(() => router.push("/admin/facilities-manager/login"));
  }, [router]);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/analytics?institutionId=${encodeURIComponent(institutionId)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setData(await res.json());
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e.message ?? "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(fetchData, 5 * 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // ── Sort utilization table ─────────────────────────────────────────────────
  const sortedUtilization = useMemo(() => {
    if (!data) return [];
    return [...data.utilizationByRoom].sort((a, b) => {
      const diff = a[sortKey] - b[sortKey];
      return sortDir === "desc" ? -diff : diff;
    });
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortBtn = ({ col }: { col: SortKey }) => (
    <button onClick={() => toggleSort(col)} className="ml-1 text-gray-500 hover:text-gray-500 inline-flex items-center">
      {sortKey === col
        ? (sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)
        : <ArrowUpDown className="w-3 h-3 opacity-40" />}
    </button>
  );

  // ─────────────────────────────────────────────────────────────────────────
  if (!institutionId) return null;

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-indigo-800 dark:text-indigo-700">Analytics</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            Room booking insights for your institution
            {lastUpdated && <span> · Updated {lastUpdated.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>}
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-gray-500 dark:text-gray-700 hover:bg-slate-50 dark:hover:bg-gray-100 disabled:opacity-50 transition-colors self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl p-4 text-rose-700 dark:text-rose-600">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
          <button onClick={fetchData} className="ml-auto px-3 py-1 text-xs bg-rose-600 text-gray-900 rounded-lg hover:bg-rose-700">Retry</button>
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* ── KPI cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Total Bookings"
              value={String(data.summary.totalBookings)}
              sub="Last 90 days"
              color="bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-950/40 dark:to-indigo-900/30 border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-200"
            />
            <KpiCard
              label="This Week"
              value={String(data.summary.thisWeekCount)}
              sub={`${data.summary.todayCount} today`}
              color="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200"
            />
            <KpiCard
              label="Avg Duration"
              value={fmtDuration(data.summary.avgDurationMinutes)}
              sub="Per session"
              color="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/40 dark:to-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
            />
            <KpiCard
              label="Cancellation Rate"
              value={`${data.summary.cancellationRate}%`}
              sub={`${data.summary.activeHoldsCount} active hold${data.summary.activeHoldsCount !== 1 ? "s" : ""}`}
              color="bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-950/40 dark:to-rose-900/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200"
            />
          </div>

          {/* ── Room status grid ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <RoomStatusCard label="Free"        count={data.roomsSummary.free}        total={data.roomsSummary.total} color="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-700" icon={<CheckCircle2 className="w-4 h-4" />} />
            <RoomStatusCard label="Reserved"    count={data.roomsSummary.reserved}    total={data.roomsSummary.total} color="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-700"   icon={<Clock className="w-4 h-4" />} />
            <RoomStatusCard label="Occupied"    count={data.roomsSummary.occupied}    total={data.roomsSummary.total} color="bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-700"         icon={<Users className="w-4 h-4" />} />
            <RoomStatusCard label="Unavailable" count={data.roomsSummary.unavailable} total={data.roomsSummary.total} color="bg-slate-50 dark:bg-gray-50 border-slate-200 text-gray-500 dark:text-gray-700"   icon={<XCircle className="w-4 h-4" />} />
          </div>

          {/* ── Trend + Peak hours ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Trend chart */}
            <div className="bg-white dark:bg-gray-50 border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-indigo-500" />
                <h2 className="font-semibold text-slate-800 dark:text-gray-800">Bookings — Last 30 Days</h2>
              </div>
              {data.bookingsByDay.length > 0
                ? <TrendChart data={data.bookingsByDay} />
                : <div className="h-32 flex items-center justify-center text-gray-500 text-sm">No data</div>
              }
            </div>

            {/* Peak hours */}
            <div className="bg-white dark:bg-gray-50 border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-amber-500" />
                <h2 className="font-semibold text-slate-800 dark:text-gray-800">Peak Booking Hours</h2>
              </div>
              <PeakHoursChart data={data.peakHours} />
            </div>
          </div>

          {/* ── Top rooms + Status breakdown ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top rooms */}
            <div className="bg-white dark:bg-gray-50 border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="w-4 h-4 text-indigo-500" />
                <h2 className="font-semibold text-slate-800 dark:text-gray-800">Top Rooms by Bookings</h2>
                <span className="text-xs text-gray-500 ml-auto">90-day window</span>
              </div>
              {data.topRooms.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">No bookings recorded</p>
              ) : (
                <div className="space-y-3">
                  {data.topRooms.map((r, i) => {
                    const maxCount = data.topRooms[0]?.count ?? 1;
                    const pct = Math.round((r.count / Math.max(maxCount, 1)) * 100);
                    return (
                      <div key={r.roomId}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-500 w-4">{i + 1}</span>
                            <span className="text-sm font-semibold text-slate-700 dark:text-gray-700">
                              {r.roomCode}
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-bold text-indigo-600 dark:text-indigo-600">{r.count}</span>
                            <span className="text-xs text-gray-500 ml-1">
                              · {Math.round(r.totalMinutes / 60 * 10) / 10}h
                            </span>
                          </div>
                        </div>
                        <div className="h-2 bg-slate-100 dark:bg-gray-200 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.7, delay: i * 0.05 }}
                            className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400 rounded-full"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Status breakdown */}
            <div className="bg-white dark:bg-gray-50 border border-slate-200 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 className="w-4 h-4 text-purple-500" />
                <h2 className="font-semibold text-slate-800 dark:text-gray-800">Booking Status Breakdown</h2>
              </div>
              {data.summary.totalBookings === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">No bookings recorded</p>
              ) : (() => {
                const total = data.summary.totalBookings;
                const statuses = [
                  { key: "reserved",  label: "Reserved",  color: "bg-amber-400",    text: "text-amber-700 dark:text-amber-700"   },
                  { key: "occupied",  label: "Occupied",  color: "bg-rose-400",     text: "text-rose-700 dark:text-rose-700"     },
                  { key: "completed", label: "Completed", color: "bg-emerald-400",  text: "text-emerald-700 dark:text-emerald-700" },
                  { key: "cancelled", label: "Cancelled", color: "bg-slate-400",    text: "text-gray-500 dark:text-gray-700"   },
                ];
                return (
                  <div className="space-y-4">
                    {/* Stacked bar */}
                    <div className="flex h-6 rounded-full overflow-hidden gap-px">
                      {statuses.map(s => {
                        const count = data.summary.statusCounts[s.key] ?? 0;
                        const w = (count / total) * 100;
                        if (w < 1) return null;
                        return (
                          <div key={s.key} title={`${s.label}: ${count}`} className={`${s.color} transition-all`} style={{ width: `${w}%` }} />
                        );
                      })}
                    </div>
                    {/* Legend */}
                    <div className="space-y-2">
                      {statuses.map(s => {
                        const count = data.summary.statusCounts[s.key] ?? 0;
                        const pct = Math.round((count / total) * 100);
                        return (
                          <div key={s.key} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${s.color}`} />
                              <span className={`text-sm ${s.text}`}>{s.label}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="w-24 h-1.5 bg-slate-100 dark:bg-gray-200 rounded-full overflow-hidden">
                                <div className={`h-full ${s.color} rounded-full`} style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-sm font-semibold text-slate-700 dark:text-gray-700 w-12 text-right">
                                {count} <span className="text-gray-500 font-normal text-xs">({pct}%)</span>
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Room utilization table ── */}
          <div className="bg-white dark:bg-gray-50 border border-slate-200 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2 p-5 border-b border-slate-100">
              <Zap className="w-4 h-4 text-indigo-500" />
              <h2 className="font-semibold text-slate-800 dark:text-gray-800">Room Utilization</h2>
              <span className="text-xs text-gray-500 ml-auto">Last 30 days · 12 operating hrs/day</span>
            </div>
            {sortedUtilization.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">No rooms found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-gray-50 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                      <th className="px-5 py-3 text-left">Room</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Cap.</th>
                      <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => toggleSort("bookingCount")}>
                        Bookings <SortBtn col="bookingCount" />
                      </th>
                      <th className="px-4 py-3 text-left cursor-pointer select-none" onClick={() => toggleSort("hoursBooked")}>
                        Hrs Booked <SortBtn col="hoursBooked" />
                      </th>
                      <th className="px-4 py-3 text-left min-w-[160px] cursor-pointer select-none" onClick={() => toggleSort("utilizationPct")}>
                        Utilization <SortBtn col="utilizationPct" />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gray-100/60">
                    {sortedUtilization.map((r, i) => {
                      const utilColor = r.utilizationPct >= 70 ? "bg-rose-500" : r.utilizationPct >= 40 ? "bg-amber-500" : "bg-emerald-500";
                      return (
                        <motion.tr
                          key={r.roomId}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className="hover:bg-slate-50/50 dark:hover:bg-gray-100 transition-colors"
                        >
                          <td className="px-5 py-3">
                            <div className="font-semibold text-slate-800 dark:text-gray-800">{r.roomCode}</div>
                            <div className="text-xs text-gray-500 truncate max-w-[140px]">{r.name}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-500 capitalize">{r.type}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-500">{r.capacity}</td>
                          <td className="px-4 py-3 font-medium text-slate-700 dark:text-gray-700">{r.bookingCount}</td>
                          <td className="px-4 py-3 text-slate-700 dark:text-gray-700">{r.hoursBooked}h</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-slate-100 dark:bg-gray-200 rounded-full overflow-hidden">
                                <div className={`h-full ${utilColor} rounded-full transition-all`} style={{ width: `${r.utilizationPct}%` }} />
                              </div>
                              <span className="text-xs font-semibold text-slate-700 dark:text-gray-700 w-9 text-right">{r.utilizationPct}%</span>
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}