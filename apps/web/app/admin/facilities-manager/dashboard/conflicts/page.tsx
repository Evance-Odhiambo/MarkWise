"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, RefreshCw, Building2, Clock } from "lucide-react";
import { useFacilitiesManager } from "../../context";

interface Conflict {
  roomId: string;
  roomCode: string;
  buildingCode: string;
  roomName: string;
  bookingA: { id: string; startAt: string; endAt: string; unitCode: string | null };
  bookingB: { id: string; startAt: string; endAt: string; unitCode: string | null };
}

function fmt(dt: string) {
  return new Date(dt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function durMins(s: string, e: string) {
  return Math.round((new Date(e).getTime() - new Date(s).getTime()) / 60000);
}

export default function ConflictsPage() {
  const admin = useFacilitiesManager();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    const d = await fetch(
      `/api/bookings/conflicts?institutionId=${admin.institutionId}`,
      { credentials: "include" }
    ).then(r => r.ok ? r.json() : {}) as any;
    setConflicts(d.conflicts ?? d.data ?? d ?? []);
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { load(); }, [load]);

  const cancelBooking = async (id: string) => {
    setCancelling(id);
    await fetch(`/api/bookings/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    setCancelling(null);
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-600" /> Booking Conflicts
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Double-booked rooms in the next 7 days</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Status banner */}
      {!loading && (
        <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 ${
          conflicts.length === 0
            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-700"
            : "border-rose-500/20 bg-rose-500/5 text-rose-700"
        }`}>
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">
            {conflicts.length === 0
              ? "No booking conflicts detected in the next 7 days."
              : `${conflicts.length} conflict${conflicts.length > 1 ? "s" : ""} detected — review and resolve below.`}
          </span>
        </div>
      )}

      {/* Conflict cards */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-36 rounded-2xl bg-gray-200 border border-gray-100 animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {conflicts.map((c, i) => (
            <motion.div key={`${c.roomId}-${i}`}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
              className="rounded-2xl border border-rose-500/20 bg-white border border-gray-200 overflow-hidden">
              {/* Room header */}
              <div className="flex items-center gap-3 px-5 py-3 bg-rose-500/5 border-b border-rose-500/10">
                <Building2 className="h-4 w-4 text-rose-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-rose-700">{c.roomName}</span>
                  <span className="ml-2 text-xs text-rose-600/60 font-mono">{c.buildingCode} · {c.roomCode}</span>
                </div>
                <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-medium text-rose-600">conflict</span>
              </div>

              {/* Two conflicting bookings */}
              <div className="grid sm:grid-cols-2 gap-px bg-gray-50">
                {[c.bookingA, c.bookingB].map((b, bi) => (
                  <div key={b.id} className="bg-white border border-gray-200 p-4">
                    <div className="text-xs text-gray-400 mb-1.5">Booking {bi === 0 ? "A" : "B"}</div>
                    <div className="flex items-center gap-1.5 text-sm text-gray-700 mb-0.5">
                      <Clock className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      {fmt(b.startAt)}
                    </div>
                    <div className="text-xs text-gray-400 pl-5 mb-1">
                      → {fmt(b.endAt)} ({durMins(b.startAt, b.endAt)} min)
                    </div>
                    {b.unitCode && (
                      <div className="text-xs font-mono text-amber-600 pl-5">{b.unitCode}</div>
                    )}
                    <div className="text-xs text-gray-500 font-mono pl-5 mt-1 truncate">{b.id}</div>
                    <button onClick={() => cancelBooking(b.id)} disabled={cancelling === b.id}
                      className="mt-3 rounded-xl bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-500/20 disabled:opacity-50 transition-colors">
                      {cancelling === b.id ? "Cancelling…" : "Cancel This Booking"}
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
