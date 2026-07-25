"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Clock, RefreshCw, Building2, User, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useFacilitiesManager } from "../../context";

interface Hold {
  id: string; status: string; startAt: string; endAt: string; expiresAt: string;
  room?: { name: string; roomCode: string; buildingCode: string };
  lecturer?: { name: string; email: string };
}

const STATUS_COLOR: Record<string, string> = {
  active:    "bg-amber-500/10 text-amber-600",
  expired:   "bg-gray-100 text-gray-500",
  confirmed: "bg-emerald-500/10 text-emerald-600",
  cancelled: "bg-rose-500/10 text-rose-600",
};

function fmt(dt: string) {
  return new Date(dt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function timeLeft(expiresAt: string) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m left`;
  return `${Math.floor(m / 60)}h ${m % 60}m left`;
}

export default function HoldsPage() {
  const admin = useFacilitiesManager();
  const [holds, setHolds] = useState<Hold[]>([]);
  const [activeCount, setActiveCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [expiring, setExpiring] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);

    // Fetch analytics for active count, and holds list from the holds endpoint
    const [analytics, holdsData] = await Promise.all([
      fetch(`/api/bookings/analytics?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/bookings/holds?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
    ]);

    setActiveCount(analytics?.activeHolds ?? null);
    setHolds(holdsData.holds ?? holdsData.data ?? holdsData ?? []);
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { load(); }, [load]);

  const expireHold = async (id: string) => {
    setExpiring(id);
    await fetch(`/api/bookings/holds/${id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "expired" }),
    });
    setExpiring(null);
    load();
  };

  const activeHolds = holds.filter(h => h.status === "active");
  const otherHolds = holds.filter(h => h.status !== "active");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" /> Booking Holds
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Temporary room reservations awaiting confirmation</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Active count summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 mb-2">
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-gray-800">
            {loading ? <span className="inline-block h-6 w-8 rounded bg-gray-200 animate-pulse" /> : (activeCount ?? activeHolds.length)}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">Active Holds</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 mb-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-gray-800">
            {loading ? <span className="inline-block h-6 w-8 rounded bg-gray-200 animate-pulse" /> : holds.filter(h => h.status === "confirmed").length}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">Confirmed</div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-4 col-span-2 sm:col-span-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/10 mb-2">
            <AlertTriangle className="h-4 w-4 text-rose-600" />
          </div>
          <div className="text-2xl font-bold text-gray-800">
            {loading ? <span className="inline-block h-6 w-8 rounded bg-gray-200 animate-pulse" /> : holds.filter(h => h.status === "expired").length}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">Expired</div>
        </div>
      </div>

      {/* Active holds list */}
      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-24 rounded-2xl bg-gray-200 border border-gray-100 animate-pulse" />)}</div>
      ) : holds.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-white py-14">
          <Clock className="h-8 w-8 text-slate-700" />
          <p className="text-gray-400 text-sm">No booking holds to display</p>
          <p className="text-xs text-slate-700 max-w-xs text-center">Holds are created when lecturers begin the room booking process. They expire automatically if not confirmed.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeHolds.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2">Active</h2>
              {activeHolds.map((h, i) => (
                <motion.div key={h.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className="rounded-2xl border border-amber-500/15 bg-white border border-gray-200 p-4 mb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Building2 className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                        <span className="font-medium text-gray-800">{h.room?.name ?? "—"}</span>
                        <span className="font-mono text-xs text-gray-400">{h.room?.buildingCode}/{h.room?.roomCode}</span>
                      </div>
                      {h.lecturer && (
                        <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                          <User className="h-3 w-3" /> {h.lecturer.name}
                          <span className="text-gray-500">{h.lecturer.email}</span>
                        </div>
                      )}
                      <div className="text-xs text-gray-400">
                        {fmt(h.startAt)} → {fmt(h.endAt)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-medium text-amber-600 mb-2">{timeLeft(h.expiresAt)}</div>
                      <button onClick={() => expireHold(h.id)} disabled={expiring === h.id}
                        className="rounded-lg bg-rose-500/10 px-2.5 py-1 text-xs text-rose-600 hover:bg-rose-500/20 disabled:opacity-50">
                        {expiring === h.id ? "…" : "Expire"}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {otherHolds.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">History</h2>
              <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400">Room</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 hidden md:table-cell">Lecturer</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 hidden lg:table-cell">Time</th>
                        <th className="text-center px-4 py-2.5 text-xs font-semibold text-gray-400">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {otherHolds.map((h, i) => (
                        <motion.tr key={h.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                          className="border-b border-gray-200/50 hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="text-gray-700">{h.room?.name ?? "—"}</div>
                            <div className="text-xs text-gray-500 font-mono">{h.room?.buildingCode}/{h.room?.roomCode}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-sm hidden md:table-cell">{h.lecturer?.name ?? "—"}</td>
                          <td className="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">{fmt(h.startAt)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_COLOR[h.status] ?? "bg-gray-100 text-gray-500"}`}>
                              {h.status}
                            </span>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
