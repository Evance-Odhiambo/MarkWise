"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar, Search, X, ChevronLeft, ChevronRight, Clock,
  CheckCircle2, XCircle, Download, Building2, Hash,
  RefreshCw, Trash2, AlertTriangle, ChevronDown, ChevronUp,
  BookOpen, Users, Timer, MapPin,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type BookingStatus = "reserved" | "occupied" | "cancelled" | "completed";

type Booking = {
  id: string;
  roomId: string;
  lecturerId: string | null;
  unitId: string | null;
  unitCode: string | null;
  holdId: string | null;
  idempotencyKey: string | null;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  createdAt: string;
  room: { id: string; buildingCode: string; roomCode: string; name: string; capacity: number; type: string; floor: number; } | null;
  lecturer: { id: string; fullName: string; email: string; } | null;
  unit: { id: string; code: string; name: string; } | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(start: string, end: string): string {
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function offsetIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function exportToCsv(bookings: Booking[]) {
  const headers = ["Room", "Building", "Unit", "Lecturer", "Date", "Start", "End", "Duration", "Status", "Booking ID"];
  const rows = bookings.map(b => [
    b.room?.roomCode ?? "",
    b.room?.buildingCode ?? "",
    b.unitCode ?? b.unit?.code ?? "",
    b.lecturer?.fullName ?? b.lecturer?.email ?? "",
    formatDate(b.startAt),
    formatTime(b.startAt),
    formatTime(b.endAt),
    formatDuration(b.startAt, b.endAt),
    b.status,
    b.id,
  ]);
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bookings-${todayIso()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<BookingStatus, { label: string; bg: string; text: string; dot: string }> = {
  reserved:  { label: "Reserved",  bg: "bg-amber-100 dark:bg-amber-900/30",   text: "text-amber-700 dark:text-amber-700",   dot: "bg-amber-500"  },
  occupied:  { label: "Occupied",  bg: "bg-rose-100 dark:bg-rose-900/30",     text: "text-rose-700 dark:text-rose-700",     dot: "bg-rose-500"   },
  cancelled: { label: "Cancelled", bg: "bg-slate-100 dark:bg-gray-50",   text: "text-gray-500 dark:text-gray-700",   dot: "bg-slate-400"  },
  completed: { label: "Completed", bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-700 dark:text-emerald-700", dot: "bg-emerald-500" },
};

const TABS: Array<{ key: string; label: string }> = [
  { key: "all",       label: "All"       },
  { key: "active",    label: "Active"    },
  { key: "upcoming",  label: "Upcoming"  },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

const PAGE_SIZE = 12;

// ─── Main Component ──────────────────────────────────────────────────────────

export default function BookingsPage() {
  const router = useRouter();

  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [lastUpdated, setLastUpdated]   = useState<Date | null>(null);
  const [bookings, setBookings]         = useState<Booking[]>([]);

  const [tab, setTab]             = useState("all");
  const [search, setSearch]       = useState("");
  const [fromDate, setFromDate]   = useState(offsetIso(-30));
  const [toDate, setToDate]       = useState(offsetIso(7));
  const [sortDesc, setSortDesc]   = useState(true);
  const [page, setPage]           = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelling, setCancelling]     = useState(false);
  const [refreshTick, setRefreshTick]   = useState(0);

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
  const fetchBookings = useCallback(async () => {
    if (!institutionId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ institutionId, from: fromDate, to: toDate });
      const res = await fetch(`/api/bookings?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setBookings(data.bookings ?? []);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e.message ?? "Failed to load bookings");
    } finally {
      setLoading(false);
    }
  }, [institutionId, fromDate, toDate]);

  useEffect(() => { fetchBookings(); }, [fetchBookings, refreshTick]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const id = setInterval(() => setRefreshTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Tab / filter counts ────────────────────────────────────────────────────
  const now = new Date();

  const tabCounts = useMemo(() => {
    const active   = bookings.filter(b => b.status === "reserved" || b.status === "occupied").length;
    const upcoming = bookings.filter(b => b.status === "reserved" && new Date(b.startAt) > now).length;
    return {
      all:       bookings.length,
      active,
      upcoming,
      completed: bookings.filter(b => b.status === "completed").length,
      cancelled: bookings.filter(b => b.status === "cancelled").length,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings]);

  // ── Filtered + sorted list ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const refreshNow = new Date();
    let list = bookings;
    // Tab filter
    if (tab === "active")    list = list.filter(b => b.status === "reserved" || b.status === "occupied");
    if (tab === "upcoming")  list = list.filter(b => b.status === "reserved" && new Date(b.startAt) > refreshNow);
    if (tab === "completed") list = list.filter(b => b.status === "completed");
    if (tab === "cancelled") list = list.filter(b => b.status === "cancelled");
    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(b =>
        (b.room?.roomCode ?? "").toLowerCase().includes(q) ||
        (b.room?.buildingCode ?? "").toLowerCase().includes(q) ||
        (b.unitCode ?? b.unit?.code ?? "").toLowerCase().includes(q) ||
        (b.lecturer?.fullName ?? b.lecturer?.email ?? "").toLowerCase().includes(q)
      );
    }
    // Sort
    list = [...list].sort((a, b) => {
      const diff = new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
      return sortDesc ? -diff : diff;
    });
    return list;
  }, [bookings, tab, search, sortDesc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageBookings = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [tab, search, fromDate, toDate]);

  // ── Cancel ────────────────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/bookings/${cancelTarget.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Server ${res.status}`);
      }
      setBookings(prev => prev.map(b => b.id === cancelTarget.id ? { ...b, status: "cancelled" } : b));
      setCancelTarget(null);
    } catch (e: any) {
      alert(`Cancel failed: ${e.message}`);
    } finally {
      setCancelling(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  if (!institutionId) return null; // waiting for auth check

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-indigo-800 dark:text-indigo-700">Bookings</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
            All room bookings for your institution
            {lastUpdated && <span> · Updated {lastUpdated.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setRefreshTick(t => t + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-gray-500 dark:text-gray-700 hover:bg-slate-50 dark:hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => exportToCsv(filtered)}
            disabled={filtered.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {TABS.map(t => {
          const count = tabCounts[t.key as keyof typeof tabCounts];
          const colors: Record<string, string> = {
            all: "from-indigo-50 to-indigo-100 dark:from-indigo-950/40 dark:to-indigo-900/30 border-indigo-200 dark:border-indigo-800",
            active: "from-amber-50 to-amber-100 dark:from-amber-950/40 dark:to-amber-900/30 border-amber-200 dark:border-amber-800",
            upcoming: "from-blue-50 to-blue-100 dark:from-blue-950/40 dark:to-blue-900/30 border-blue-200 dark:border-blue-800",
            completed: "from-emerald-50 to-emerald-100 dark:from-emerald-950/40 dark:to-emerald-900/30 border-emerald-200 dark:border-emerald-800",
            cancelled: "from-slate-50 to-slate-100 dark:from-slate-900/40 dark:to-slate-800/30 border-slate-200",
          };
          const textColors: Record<string, string> = {
            all: "text-indigo-800 dark:text-indigo-700", active: "text-amber-700 dark:text-amber-700",
            upcoming: "text-blue-700 dark:text-blue-700", completed: "text-emerald-700 dark:text-emerald-700",
            cancelled: "text-gray-500 dark:text-gray-700",
          };
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`bg-gradient-to-br ${colors[t.key]} border rounded-xl p-3 text-left transition-all ${tab === t.key ? "ring-2 ring-indigo-400 dark:ring-indigo-500 shadow-md" : "hover:shadow-sm"}`}
            >
              <div className={`text-2xl font-bold ${textColors[t.key]}`}>{count}</div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t.label}</div>
            </button>
          );
        })}
      </div>

      {/* ── Filters ── */}
      <div className="bg-white dark:bg-gray-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search room, building, unit, lecturer…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-500">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {/* Date range */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Calendar className="w-4 h-4 text-gray-500" />
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <span className="text-gray-500 text-sm">to</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-2 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        {/* Sort */}
        <button
          onClick={() => setSortDesc(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white dark:bg-slate-700 text-gray-500 dark:text-gray-700 hover:bg-slate-50 dark:hover:bg-slate-600 flex-shrink-0"
        >
          {sortDesc ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          {sortDesc ? "Newest first" : "Oldest first"}
        </button>
      </div>

      {/* ── Bookings table ── */}
      <div className="bg-white dark:bg-gray-50 border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          // Skeleton
          <div className="divide-y divide-slate-100 dark:divide-gray-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-4 flex items-center gap-3 animate-pulse">
                <div className="h-10 w-10 rounded-lg bg-slate-100 dark:bg-slate-700 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 rounded bg-slate-100 dark:bg-slate-700" />
                  <div className="h-3 w-48 rounded bg-slate-100 dark:bg-slate-700" />
                </div>
                <div className="h-6 w-20 rounded-full bg-slate-100 dark:bg-slate-700" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <AlertTriangle className="w-10 h-10 text-rose-600" />
            <p className="text-rose-600 dark:text-rose-600 font-medium">{error}</p>
            <button onClick={fetchBookings} className="px-4 py-2 text-sm bg-indigo-600 text-gray-900 rounded-lg hover:bg-indigo-700">
              Try again
            </button>
          </div>
        ) : pageBookings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <BookOpen className="w-10 h-10 text-gray-700 dark:text-gray-500" />
            <p className="text-gray-400 dark:text-gray-500 font-medium">No bookings found</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Try adjusting the date range or clearing the search</p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-4 px-4 py-2 bg-slate-50 dark:bg-gray-50 border-b border-slate-100">
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Room</span>
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">When</span>
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Unit / Lecturer</span>
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Status</span>
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Action</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-gray-100/60">
              {pageBookings.map(booking => {
                const s = STATUS_CFG[booking.status];
                const isExpanded = expandedId === booking.id;
                const canCancel = booking.status === "reserved" || booking.status === "occupied";
                return (
                  <motion.div key={booking.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    {/* Main row */}
                    <div
                      className="px-4 py-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 sm:gap-4 items-center hover:bg-slate-50/50 dark:hover:bg-gray-100 cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : booking.id)}
                    >
                      {/* Room */}
                      <div className="flex items-center gap-2">
                        <div className="h-9 w-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
                          <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-600" />
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-slate-800 dark:text-gray-800">
                            {booking.room?.roomCode ?? "—"}
                          </div>
                          <div className="text-xs text-gray-500 capitalize">{booking.room?.type ?? ""}</div>
                        </div>
                      </div>
                      {/* When */}
                      <div>
                        <div className="text-sm text-slate-700 dark:text-gray-700 font-medium">{formatDate(booking.startAt)}</div>
                        <div className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(booking.startAt)} – {formatTime(booking.endAt)}
                          <span className="ml-1 text-indigo-500 dark:text-indigo-600">({formatDuration(booking.startAt, booking.endAt)})</span>
                        </div>
                      </div>
                      {/* Unit / Lecturer */}
                      <div>
                        <div className="text-sm text-slate-700 dark:text-gray-700">{booking.unitCode ?? booking.unit?.code ?? "—"}</div>
                        <div className="text-xs text-gray-500">{booking.lecturer?.fullName ?? booking.lecturer?.email ?? "—"}</div>
                      </div>
                      {/* Status */}
                      <div className="flex items-center" onClick={e => e.stopPropagation()}>
                        <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                          {s.label}
                        </span>
                      </div>
                      {/* Action */}
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        {canCancel && (
                          <button
                            onClick={() => setCancelTarget(booking)}
                            title="Cancel booking"
                            className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <button className="p-1.5 rounded-lg text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-100 transition-colors">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
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
                          <div className="px-4 pb-4 pt-1 bg-slate-50/60 dark:bg-slate-900/30 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            {[
                              { label: "Booking ID", value: booking.id.slice(0, 8) + "…" },
                              { label: "Hold ID",    value: booking.holdId ? booking.holdId.slice(0, 8) + "…" : "—" },
                              { label: "Created",    value: formatDateTime(booking.createdAt) },
                              { label: "Capacity",   value: booking.room?.capacity ? `${booking.room.capacity} seats` : "—" },
                            ].map(item => (
                              <div key={item.label} className="bg-white rounded-lg px-3 py-2">
                                <div className="text-gray-500 dark:text-gray-400 text-xs">{item.label}</div>
                                <div className="text-slate-700 dark:text-gray-700 font-mono mt-0.5 break-all">{item.value}</div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Pagination ── */}
      {!loading && !error && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400 dark:text-gray-500">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="p-2 rounded-lg border border-slate-200 text-gray-500 dark:text-gray-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-gray-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => {
              const p = totalPages <= 7 ? i + 1 : i < 3 ? i + 1 : i === 3 ? page : totalPages - 2 + (i - 4);
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${p === page ? "bg-indigo-600 text-gray-900" : "border border-slate-200 text-gray-500 dark:text-gray-700 hover:bg-slate-50 dark:hover:bg-gray-100"}`}
                >
                  {p}
                </button>
              );
            })}
            <button
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="p-2 rounded-lg border border-slate-200 text-gray-500 dark:text-gray-700 disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-gray-100 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Cancel Modal ── */}
      <AnimatePresence>
        {cancelTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => !cancelling && setCancelTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.93, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.93, opacity: 0, y: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800 dark:text-gray-800">Cancel Booking</h2>
                  <p className="text-sm text-gray-400 dark:text-gray-500">This action will notify the assigned lecturer.</p>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 mb-5 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-slate-700 dark:text-gray-700">
                  <Building2 className="w-4 h-4 text-gray-500" />
                  <span className="font-medium">{cancelTarget.room?.roomCode}</span>
                  <span className="text-gray-500">{cancelTarget.room?.name}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-500 dark:text-gray-500">
                  <Clock className="w-4 h-4 text-gray-500" />
                  {formatDate(cancelTarget.startAt)}, {formatTime(cancelTarget.startAt)} – {formatTime(cancelTarget.endAt)}
                  <span className="text-indigo-500 dark:text-indigo-600">({formatDuration(cancelTarget.startAt, cancelTarget.endAt)})</span>
                </div>
                {(cancelTarget.unitCode ?? cancelTarget.unit?.code) && (
                  <div className="flex items-center gap-2 text-gray-500 dark:text-gray-500">
                    <Hash className="w-4 h-4 text-gray-500" />
                    {cancelTarget.unitCode ?? cancelTarget.unit?.code}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  disabled={cancelling}
                  onClick={() => setCancelTarget(null)}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded-xl border border-slate-200 text-gray-500 dark:text-gray-700 hover:bg-slate-50 dark:hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Go Back
                </button>
                <button
                  disabled={cancelling}
                  onClick={handleCancel}
                  className="flex-1 px-4 py-2 text-sm font-bold rounded-xl bg-rose-600 text-gray-900 hover:bg-rose-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {cancelling ? <RefreshCw className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  {cancelling ? "Cancelling…" : "Confirm Cancellation"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
