"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { DoorOpen, Search, X, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useSystemAdmin } from "../../context";

interface Room {
  id: string;
  name: string;
  buildingCode: string;
  roomCode: string;
  type: string;
  capacity: number;
  floor: number;
  status: string;
  isActive: boolean;
}

const STATUS_BADGE: Record<string, string> = {
  free:    "bg-emerald-500/10 text-emerald-600",
  booked:  "bg-blue-500/10 text-blue-600",
  held:    "bg-amber-500/10 text-amber-600",
  offline: "bg-slate-500/10 text-gray-500",
};
const STATUS_ICON: Record<string, React.ElementType> = {
  free:    CheckCircle2,
  booked:  Clock,
  held:    Clock,
  offline: XCircle,
};

const PAGE_SIZE = 30;

export default function RoomsPage() {
  const admin = useSystemAdmin();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  const fetchRooms = useCallback(async () => {
    if (!admin?.institutionId) { setLoading(false); return; }
    setLoading(true);
    const r = await fetch(`/api/rooms?institutionId=${admin.institutionId}`, { credentials: "include" });
    if (r.ok) {
      const data = await r.json();
      // API wraps response: { apiVersion, data: { rooms: [] } }
      const payload = data?.data ?? data;
      setRooms(Array.isArray(payload) ? payload : (payload?.rooms ?? []));
    }
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const types = useMemo(
    () => [...new Set(rooms.map(r => r.type))].filter(Boolean).sort(),
    [rooms]
  );

  const { filtered, totalPages, paged, counts } = useMemo(() => {
    const sq = search.toLowerCase();
    const filtered = rooms.filter(r => {
      const matchSearch =
        r.name.toLowerCase().includes(sq) ||
        r.buildingCode.toLowerCase().includes(sq) ||
        r.roomCode.toLowerCase().includes(sq);
      const matchType   = typeFilter === "all"   || r.type === typeFilter;
      const matchStatus = statusFilter === "all" || r.status === statusFilter;
      return matchSearch && matchType && matchStatus;
    });
    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    // Single pass over full rooms array for status counts
    const counts = { total: rooms.length, free: 0, booked: 0, held: 0 };
    for (const r of rooms) {
      if (r.status === "free")   counts.free++;
      else if (r.status === "booked") counts.booked++;
      else if (r.status === "held")   counts.held++;
    }
    return { filtered, totalPages, paged, counts };
  }, [rooms, search, typeFilter, statusFilter, page]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-800">Rooms</h1>
        <p className="text-xs text-gray-400 mt-0.5">{rooms.length} room{rooms.length !== 1 ? "s" : ""} registered</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Rooms",   value: counts.total,  color: "text-orange-600", bg: "bg-orange-500/10" },
          { label: "Available",     value: counts.free,   color: "text-emerald-600",bg: "bg-emerald-500/10" },
          { label: "Booked",        value: counts.booked, color: "text-blue-600",   bg: "bg-blue-500/10" },
          { label: "On Hold",       value: counts.held,   color: "text-amber-600",  bg: "bg-amber-500/10" },
        ].map((c, i) => (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="rounded-xl border border-gray-200 bg-white border border-gray-200 p-4"
          >
            <div className={`text-2xl font-bold ${c.color}`}>
              {loading ? <span className="inline-block h-6 w-8 rounded bg-gray-200 animate-pulse" /> : c.value}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{c.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-4 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
            placeholder="Search room name, building, code..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
        >
          <option value="all">All Types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-500/50"
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="all">All Status</option>
          <option value="free">Available</option>
          <option value="booked">Booked</option>
          <option value="held">On Hold</option>
          <option value="offline">Offline</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="h-6 w-6 rounded-full border-2 border-orange-500 border-t-transparent"
            />
          </div>
        ) : paged.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <DoorOpen className="h-10 w-10 text-slate-700 mb-3" />
            <p className="text-sm text-gray-400">
              {search || typeFilter !== "all" || statusFilter !== "all"
                ? "No rooms match your filters."
                : "No rooms registered yet."}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-400">
                <th className="px-4 py-3 text-left font-medium">Room</th>
                <th className="px-4 py-3 text-left font-medium hidden sm:table-cell">Type</th>
                <th className="px-4 py-3 text-left font-medium hidden md:table-cell">Capacity</th>
                <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Floor</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {paged.map((room, i) => {
                const StatusIcon = STATUS_ICON[room.status] ?? DoorOpen;
                return (
                  <motion.tr
                    key={room.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10 shrink-0">
                          <DoorOpen className="h-3.5 w-3.5 text-orange-600" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{room.name}</div>
                          <div className="text-xs text-gray-400">{room.buildingCode} · {room.roomCode}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-gray-500 capitalize">{room.type}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-500">{room.capacity}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-gray-500">
                      {room.floor === 0 ? "Ground" : `Floor ${room.floor}`}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium capitalize ${STATUS_BADGE[room.status] ?? "bg-slate-700 text-gray-500"}`}>
                        <StatusIcon className="h-3 w-3" />
                        {room.status}
                      </span>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">
            Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
