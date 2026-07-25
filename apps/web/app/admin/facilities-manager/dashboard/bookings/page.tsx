"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  CalendarCheck, Search, Filter, AlertTriangle, X,
  CheckCircle2, XCircle, Clock, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useFacilitiesManager } from "../../context";

interface Booking {
  id: string; status: string; startAt: string; endAt: string;
  unitCode?: string;
  room?: { name: string; roomCode: string; buildingCode: string };
  lecturer?: { name: string };
  unit?: { code: string; title: string };
}

const STATUS_COLOR: Record<string, string> = {
  reserved:  "bg-amber-500/10 text-amber-600",
  occupied:  "bg-sky-500/10 text-sky-600",
  completed: "bg-emerald-500/10 text-emerald-600",
  cancelled: "bg-rose-500/10 text-rose-600",
};

const PAGE = 30;

function fmt(dt: string) {
  return new Date(dt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function durMins(s: string, e: string) {
  return Math.round((new Date(e).getTime() - new Date(s).getTime()) / 60000);
}

export default function BookingsPage() {
  const admin = useFacilitiesManager();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    const d = await fetch(
      `/api/bookings?institutionId=${admin.institutionId}`,
      { credentials: "include" }
    ).then(r => r.ok ? r.json() : {}) as any;
    setBookings(d.bookings ?? d.data ?? d ?? []);
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { load(); }, [load]);

  const cancel = async (id: string) => {
    setCancelling(id);
    await fetch(`/api/bookings/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    setCancelling(null);
    load();
  };

  const q = search.toLowerCase();
  const filtered = bookings.filter(b => {
    const matchQ = !q || b.room?.name.toLowerCase().includes(q) || b.room?.roomCode.toLowerCase().includes(q)
      || b.lecturer?.name.toLowerCase().includes(q) || (b.unitCode ?? b.unit?.code ?? "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || b.status === statusFilter;
    return matchQ && matchStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const slice = filtered.slice((page - 1) * PAGE, page * PAGE);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-emerald-600" /> Bookings
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">{bookings.length} bookings · {filtered.length} shown</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by room, lecturer, or unit…"
            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
          <option value="all">All Statuses</option>
          <option value="reserved">Reserved</option>
          <option value="occupied">Occupied</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Room</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 hidden md:table-cell">Time</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 hidden lg:table-cell">Lecturer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 hidden lg:table-cell">Unit</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="border-b border-gray-200/50">
                    {[1,2,3,4,5,6].map(j => <td key={j} className="px-4 py-3"><div className="h-5 rounded bg-gray-200 animate-pulse" /></td>)}
                  </tr>
                ))
              ) : slice.length === 0 ? (
                <tr><td colSpan={6} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertTriangle className="h-7 w-7 text-slate-700" />
                    <p className="text-gray-400">{search ? "No bookings match your search" : "No bookings found"}</p>
                  </div>
                </td></tr>
              ) : slice.map((b, i) => (
                <motion.tr key={b.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.015 }}
                  className="border-b border-gray-200/50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{b.room?.name ?? "—"}</div>
                    <div className="text-xs text-gray-400 font-mono">{b.room?.buildingCode} · {b.room?.roomCode}</div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="text-xs text-gray-700">{fmt(b.startAt)}</div>
                    <div className="text-xs text-gray-400">{durMins(b.startAt, b.endAt)} min</div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-sm hidden lg:table-cell">{b.lecturer?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs font-mono hidden lg:table-cell">{b.unitCode ?? b.unit?.code ?? "—"}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_COLOR[b.status] ?? "bg-gray-100 text-gray-500"}`}>
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(b.status === "reserved" || b.status === "occupied") ? (
                      <button onClick={() => cancel(b.id)} disabled={cancelling === b.id}
                        className="rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-500/20 disabled:opacity-50">
                        {cancelling === b.id ? "…" : "Cancel"}
                      </button>
                    ) : <span className="text-slate-700 text-xs">—</span>}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > PAGE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
