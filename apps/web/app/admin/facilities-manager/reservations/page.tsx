"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarClock, Search, X, Clock, Download, Building2,
  RefreshCw, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, Calendar,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type DayBooking = {
  id: string;
  startAt: string;
  endAt: string;
  status: "reserved" | "occupied";
  unitCode: string | null;
  unitName: string | null;
  lecturerName: string | null;
};

type DaySchedule = {
  day: string;
  date: string;
  status: "free" | "reserved" | "occupied" | "unavailable";
  bookings: DayBooking[];
};

type WeeklyRoom = {
  id: string;
  buildingCode: string;
  roomCode: string;
  name: string;
  capacity: number;
  type: string;
  floor: number;
  status: string;
  weekSchedule: DaySchedule[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  free:        { bg: "bg-emerald-50 dark:bg-emerald-900/20", text: "text-emerald-700 dark:text-emerald-700", dot: "bg-emerald-500", label: "Free" },
  reserved:    { bg: "bg-amber-50 dark:bg-amber-900/20",    text: "text-amber-700 dark:text-amber-700",    dot: "bg-amber-500",   label: "Reserved" },
  occupied:    { bg: "bg-blue-50 dark:bg-blue-900/20",      text: "text-blue-700 dark:text-blue-700",      dot: "bg-blue-500",    label: "Occupied" },
  unavailable: { bg: "bg-slate-100 dark:bg-slate-800",       text: "text-gray-400 dark:text-gray-500",    dot: "bg-slate-400",   label: "Unavailable" },
};

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function todayIso() { return new Date().toISOString().slice(0, 10); }

function exportWeekCsv(rooms: WeeklyRoom[]) {
  const header = ["Building", "Room", "Name", "Capacity", "Type", ...DAY_ABBR.map((d, i) => `${d} Status`), ...DAY_ABBR.map((d) => `${d} Bookings`)];
  const rows = rooms.map((r) => {
    const statuses = r.weekSchedule.map((d) => d.status);
    const bookingSummaries = r.weekSchedule.map((d) =>
      d.bookings.map((b) => `${fmtTime(b.startAt)}-${fmtTime(b.endAt)} ${b.unitCode ?? ""}`).join("; ") || "—"
    );
    return [r.buildingCode, r.roomCode, r.name, String(r.capacity), r.type, ...statuses, ...bookingSummaries];
  });
  const csv = [header, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `room-schedule-${todayIso()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReservationsPage() {
  const router = useRouter();

  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<WeeklyRoom[]>([]);
  const [weekRange, setWeekRange] = useState<{ start: string; end: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [search, setSearch] = useState("");
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);

  // ── Auth ──
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.institutionId) { router.push("/admin/facilities-manager/login"); return; }
        setInstitutionId(data.institutionId);
      })
      .catch(() => router.push("/admin/facilities-manager/login"));
  }, [router]);

  // ── Fetch ──
  const fetchWeekly = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ institutionId });
      const res = await fetch(`/api/rooms/weekly?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json = await res.json();
      const data = json.data ?? json;
      setRooms(data.rooms ?? []);
      setWeekRange(data.week ?? null);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e.message ?? "Failed to load weekly schedule");
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  useEffect(() => { fetchWeekly(); }, [fetchWeekly]);

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(fetchWeekly, 60_000);
    return () => clearInterval(id);
  }, [fetchWeekly]);

  // ── Derived ──
  const today = todayIso();

  const filtered = useMemo(() => {
    if (!search.trim()) return rooms;
    const q = search.trim().toLowerCase();
    return rooms.filter((r) =>
      r.buildingCode.toLowerCase().includes(q) ||
      r.roomCode.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.weekSchedule.some((d) => d.bookings.some((b) =>
        (b.unitCode ?? "").toLowerCase().includes(q) ||
        (b.lecturerName ?? "").toLowerCase().includes(q)
      ))
    );
  }, [rooms, search]);

  // Stats
  const stats = useMemo(() => {
    const total = rooms.length;
    const buildings = new Set(rooms.map((r) => r.buildingCode)).size;
    // count rooms that have at least one reserved day this week
    const reservedRooms = rooms.filter((r) => r.weekSchedule.some((d) => d.status === "reserved" || d.status === "occupied")).length;
    const freeAllWeek = rooms.filter((r) => r.weekSchedule.every((d) => d.status === "free")).length;
    const unavailableRooms = rooms.filter((r) => r.status === "unavailable").length;
    return { total, buildings, reservedRooms, freeAllWeek, unavailableRooms };
  }, [rooms]);

  // Group by building
  const grouped = useMemo(() => {
    const map = new Map<string, WeeklyRoom[]>();
    for (const r of filtered) {
      if (!map.has(r.buildingCode)) map.set(r.buildingCode, []);
      map.get(r.buildingCode)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  if (!institutionId) return null;

  // ── Render ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-indigo-800 dark:text-indigo-700 flex items-center gap-2">
            <Calendar className="w-6 h-6" />
            Weekly Room Schedule
          </h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            {weekRange ? `${weekRange.start} — ${weekRange.end}` : "This week"}
            {lastUpdated && (
              <span> · Updated {lastUpdated.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={fetchWeekly}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-gray-500 dark:text-gray-700 hover:bg-slate-50 dark:hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button
            onClick={() => exportWeekCsv(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "Total Rooms", value: stats.total, gradient: "from-indigo-50 to-indigo-100 dark:from-indigo-950/40 dark:to-indigo-900/30 border-indigo-200 dark:border-indigo-800", text: "text-indigo-800 dark:text-indigo-700" },
          { label: "Buildings", value: stats.buildings, gradient: "from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30 border-blue-200 dark:border-blue-800", text: "text-blue-700 dark:text-blue-700" },
          { label: "Booked This Week", value: stats.reservedRooms, gradient: "from-amber-50 to-amber-100 dark:from-amber-950/40 dark:to-amber-900/30 border-amber-200 dark:border-amber-800", text: "text-amber-700 dark:text-amber-700" },
          { label: "Free All Week", value: stats.freeAllWeek, gradient: "from-emerald-50 to-emerald-100 dark:from-emerald-950/40 dark:to-emerald-900/30 border-emerald-200 dark:border-emerald-800", text: "text-emerald-700 dark:text-emerald-700" },
          { label: "Unavailable", value: stats.unavailableRooms, gradient: "from-slate-50 to-slate-100 dark:from-slate-950/40 dark:to-slate-800/30 border-slate-200", text: "text-gray-500 dark:text-gray-500" },
        ].map((s) => (
          <div key={s.label} className={`bg-gradient-to-br ${s.gradient} border rounded-xl p-4`}>
            <div className={`text-3xl font-bold ${s.text}`}>{s.value}</div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Legend + Search */}
      <div className="bg-white dark:bg-gray-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search room, unit, lecturer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-500">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {Object.entries(STATUS_COLORS).map(([key, sc]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${sc.dot}`} />
              <span className="text-xs text-gray-400 dark:text-gray-500">{sc.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchWeekly} />
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {grouped.map(([building, bRooms]) => (
            <div key={building} className="space-y-2">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-500" />
                <h2 className="text-sm font-semibold text-slate-700 dark:text-gray-700 uppercase tracking-wide">
                  {building}
                </h2>
                <span className="text-xs text-gray-500 dark:text-gray-400">({bRooms.length} rooms)</span>
              </div>

              {/* Week grid table */}
              <div className="bg-white dark:bg-gray-50 border border-slate-200 rounded-xl overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[minmax(140px,1fr)_repeat(7,1fr)] gap-px bg-slate-100 dark:bg-slate-700">
                  <div className="bg-slate-50 dark:bg-gray-50 px-3 py-2.5">
                    <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Room</span>
                  </div>
                  {bRooms[0]?.weekSchedule.map((d, i) => {
                    const isToday = d.date === today;
                    return (
                      <div key={d.day} className={`px-2 py-2.5 text-center ${isToday ? "bg-indigo-50 dark:bg-indigo-900/20" : "bg-slate-50 dark:bg-gray-50"}`}>
                        <span className={`text-xs font-semibold uppercase tracking-wide ${isToday ? "text-indigo-600 dark:text-indigo-600" : "text-gray-400 dark:text-gray-500"}`}>
                          {DAY_ABBR[i]}
                        </span>
                        <div className={`text-[10px] mt-0.5 ${isToday ? "text-indigo-500 dark:text-indigo-600 font-bold" : "text-gray-500 dark:text-gray-400"}`}>
                          {new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Rows */}
                <div className="divide-y divide-slate-100 dark:divide-gray-100/60">
                  {bRooms.map((room) => {
                    const isExpanded = expandedRoom === room.id;
                    return (
                      <div key={room.id}>
                        <div
                          className="grid grid-cols-[minmax(140px,1fr)_repeat(7,1fr)] gap-px cursor-pointer hover:bg-slate-50/50 dark:hover:bg-gray-100 transition-colors"
                          onClick={() => setExpandedRoom(isExpanded ? null : room.id)}
                        >
                          {/* Room info */}
                          <div className="px-3 py-2.5 flex items-center gap-2">
                            <div>
                              <div className="text-sm font-semibold text-slate-800 dark:text-gray-800 flex items-center gap-1.5">
                                {room.roomCode}
                                {room.status === "unavailable" && (
                                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-gray-400 dark:text-gray-500">Unavailable</span>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-500 dark:text-gray-400 capitalize">
                                {room.type} · {room.capacity} seats
                              </div>
                            </div>
                          </div>
                          {/* Day cells */}
                          {room.weekSchedule.map((d, i) => {
                            const sc = STATUS_COLORS[d.status] ?? STATUS_COLORS.free;
                            const isToday = d.date === today;
                            const bookingCount = d.bookings.length;
                            return (
                              <div
                                key={d.day}
                                className={`px-1.5 py-2.5 flex flex-col items-center justify-center ${sc.bg} ${isToday ? "ring-1 ring-inset ring-indigo-300 dark:ring-indigo-600" : ""}`}
                              >
                                <span className={`w-2.5 h-2.5 rounded-full ${sc.dot}`} />
                                {bookingCount > 0 && (
                                  <span className={`text-[10px] font-medium mt-1 ${sc.text}`}>
                                    {bookingCount} slot{bookingCount !== 1 ? "s" : ""}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Expanded detail */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 py-3 bg-indigo-50/40 dark:bg-indigo-900/10 border-t border-indigo-100 dark:border-indigo-900/30">
                                <div className="text-xs font-medium text-gray-400 dark:text-gray-500 mb-2">{room.name} — Weekly Details</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                                  {room.weekSchedule.map((d, i) => {
                                    const sc = STATUS_COLORS[d.status] ?? STATUS_COLORS.free;
                                    const isDayToday = d.date === today;
                                    return (
                                      <div key={d.day} className={`rounded-lg border p-2.5 ${isDayToday ? "border-indigo-300 dark:border-indigo-600 bg-white" : "border-slate-200 bg-white"}`}>
                                        <div className="flex items-center justify-between mb-1.5">
                                          <span className={`text-xs font-semibold ${isDayToday ? "text-indigo-600 dark:text-indigo-600" : "text-gray-500 dark:text-gray-700"}`}>
                                            {d.day} {isDayToday && "·  Today"}
                                          </span>
                                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${sc.bg} ${sc.text}`}>{sc.label}</span>
                                        </div>
                                        {d.bookings.length === 0 ? (
                                          <p className="text-[11px] text-gray-500 italic">No bookings</p>
                                        ) : (
                                          <div className="space-y-1">
                                            {d.bookings.map((b) => (
                                              <div key={b.id} className="text-[11px] text-gray-500 dark:text-gray-700 flex items-start gap-1.5">
                                                <Clock className="w-3 h-3 mt-0.5 text-gray-500 flex-shrink-0" />
                                                <div>
                                                  <span className="font-medium">{fmtTime(b.startAt)}–{fmtTime(b.endAt)}</span>
                                                  {b.unitCode && <span className="ml-1 text-indigo-600 dark:text-indigo-600">{b.unitCode}</span>}
                                                  {b.lecturerName && <span className="block text-gray-500 truncate">{b.lecturerName}</span>}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-50 border border-slate-200 rounded-xl divide-y divide-slate-100 dark:divide-gray-100">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="p-4 flex items-center gap-3 animate-pulse">
          <div className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-slate-700 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-36 rounded bg-slate-100 dark:bg-slate-700" />
            <div className="h-3 w-52 rounded bg-slate-100 dark:bg-slate-700" />
          </div>
          <div className="h-6 w-16 rounded-full bg-slate-100 dark:bg-slate-700" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertTriangle className="w-10 h-10 text-rose-600" />
      <p className="text-rose-600 dark:text-rose-600 font-medium">{message}</p>
      <button onClick={onRetry} className="px-4 py-2 text-sm bg-indigo-600 text-gray-900 rounded-lg hover:bg-indigo-700 transition-colors">
        Try again
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
      <CalendarClock className="w-12 h-12 text-gray-700 dark:text-gray-500" />
      <p className="font-medium text-gray-500 dark:text-gray-500">No rooms found</p>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No rooms matched your search
      </p>
    </div>
  );
}
