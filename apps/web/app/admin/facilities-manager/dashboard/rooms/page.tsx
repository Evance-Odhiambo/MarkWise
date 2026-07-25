"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, Search, Plus, X, Filter, AlertTriangle,
  CheckCircle2, XCircle, Clock, Minus, Calendar, ChevronDown, ChevronUp,
} from "lucide-react";
import { useFacilitiesManager } from "../../context";

const inp = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500";
const lbl = "block text-xs font-medium text-gray-500 mb-1.5";

interface TimetableEntry {
  id: string;
  startTime: string;
  endTime: string;
  unitCode: string;
  unitTitle: string;
  courseName: string;
  lecturerName: string;
  departmentName: string;
}

interface Room {
  id: string; name: string; roomCode: string; buildingCode: string;
  type: string; capacity: number; floor: number;
  status: "free" | "reserved" | "occupied" | "unavailable";
  isActive: boolean;
  todayTimetable?: TimetableEntry[];
}

const STATUS_COLOR: Record<string, string> = {
  free:        "bg-emerald-500/10 text-emerald-600",
  reserved:    "bg-amber-500/10 text-amber-600",
  occupied:    "bg-sky-500/10 text-sky-600",
  unavailable: "bg-rose-500/10 text-rose-600",
};

const ROOM_TYPES = ["LEC", "LAB", "SEM", "TUT", "OFFICE", "OTHER"];

function AddRoomModal({ institutionId, onClose, onSaved }: {
  institutionId: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: "", roomCode: "", buildingCode: "", type: "LEC", capacity: "30", floor: "0" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!form.name || !form.roomCode || !form.buildingCode) { setErr("Name, room code and building code required"); return; }
    if (isNaN(Number(form.capacity)) || Number(form.capacity) < 1) { setErr("Capacity must be a positive number"); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/rooms", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, capacity: Number(form.capacity), floor: Number(form.floor), institutionId }),
      });
      if (!r.ok) { const j = await r.json(); setErr(j.error ?? "Failed"); setSaving(false); return; }
      onSaved();
    } catch { setErr("Network error"); setSaving(false); }
  };

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white border border-gray-200 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2"><Plus className="h-4 w-4 text-sky-600" /> Add Room</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <div><label className={lbl}>Room Name</label><input value={form.name} onChange={f("name")} className={inp} placeholder="e.g. Lecture Hall A" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Building Code</label><input value={form.buildingCode} onChange={f("buildingCode")} className={inp} placeholder="e.g. MAIN" /></div>
            <div><label className={lbl}>Room Code</label><input value={form.roomCode} onChange={f("roomCode")} className={inp} placeholder="e.g. LH1" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={lbl}>Type</label>
              <select value={form.type} onChange={f("type")} className={inp}>
                {ROOM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div><label className={lbl}>Capacity</label><input type="number" min={1} value={form.capacity} onChange={f("capacity")} className={inp} /></div>
            <div><label className={lbl}>Floor</label><input type="number" min={0} value={form.floor} onChange={f("floor")} className={inp} /></div>
          </div>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
            <button onClick={save} disabled={saving}
              className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-medium text-gray-900 hover:bg-sky-500 disabled:opacity-60">
              {saving ? "Saving…" : "Add Room"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function StatusBadge({ room, onToggle }: { room: Room; onToggle: () => void }) {
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    await fetch(`/api/rooms/${room.id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !room.isActive }),
    });
    setBusy(false);
    onToggle();
  };

  return (
    <button onClick={toggle} disabled={busy}
      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-opacity ${room.isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-slate-700 text-gray-400"} disabled:opacity-50`}
      title={room.isActive ? "Active — click to deactivate" : "Inactive — click to activate"}>
      {room.isActive ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {room.isActive ? "Active" : "Inactive"}
    </button>
  );
}

export default function RoomsPage() {
  const admin = useFacilitiesManager();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    const d = await fetch(`/api/rooms?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any;
    setRooms(d.rooms ?? d.data ?? d ?? []);
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { load(); }, [load]);

  const q = search.toLowerCase();
  const filtered = rooms.filter(r => {
    const matchQ = !q || r.name.toLowerCase().includes(q) || r.roomCode.toLowerCase().includes(q) || r.buildingCode.toLowerCase().includes(q);
    const matchType = typeFilter === "all" || r.type === typeFilter;
    const matchStatus = statusFilter === "all" || r.status === statusFilter;
    return matchQ && matchType && matchStatus;
  });

  const types = [...new Set(rooms.map(r => r.type))].sort();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-sky-600" /> Rooms
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">{rooms.length} rooms · {filtered.length} shown</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 rounded-xl bg-sky-600 px-3.5 py-2 text-sm font-medium text-gray-900 hover:bg-sky-500">
          <Plus className="h-4 w-4" /> Add Room
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, code, or building…"
            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50" />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
          <option value="all">All Types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
          <option value="all">All Statuses</option>
          <option value="free">Free</option>
          <option value="reserved">Reserved</option>
          <option value="occupied">Occupied</option>
          <option value="unavailable">Unavailable</option>
        </select>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Room</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 hidden md:table-cell">Building</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 hidden lg:table-cell">Type</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 hidden lg:table-cell">Cap.</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 hidden lg:table-cell">Today's Schedule</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400">Active</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="border-b border-gray-200/50">
                    {[1,2,3,4,5,6,7].map(j => <td key={j} className="px-4 py-3"><div className="h-5 rounded bg-gray-200 animate-pulse" /></td>)}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertTriangle className="h-7 w-7 text-slate-700" />
                    <p className="text-gray-400">{search ? "No rooms match your search" : "No rooms yet"}</p>
                  </div>
                </td></tr>
              ) : filtered.flatMap((r, i) => {
                const sessions = r.todayTimetable ?? [];
                const isExpanded = expandedRoomId === r.id;
                return [
                  <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="border-b border-gray-200/50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{r.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{r.roomCode} · Fl {r.floor}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden md:table-cell font-mono text-xs">{r.buildingCode}</td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{r.type}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500 hidden lg:table-cell">{r.capacity}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_COLOR[r.status] ?? "bg-gray-100 text-gray-500"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center hidden lg:table-cell">
                      {sessions.length > 0 ? (
                        <button
                          onClick={() => setExpandedRoomId(isExpanded ? null : r.id)}
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 transition-colors">
                          <Calendar className="h-3 w-3" />
                          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
                          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge room={r} onToggle={load} />
                    </td>
                  </motion.tr>,
                  isExpanded && sessions.length > 0 ? (
                    <motion.tr key={`${r.id}-expand`}
                      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="bg-violet-50/60 border-b border-violet-100">
                      <td colSpan={7} className="px-6 py-3">
                        <p className="text-xs font-semibold text-violet-700 mb-2">Today&apos;s Timetable</p>
                        <div className="flex flex-wrap gap-2">
                          {sessions.map(t => (
                            <div key={t.id} className="flex items-center gap-2.5 rounded-xl border border-violet-200 bg-white px-3 py-2 shadow-sm text-xs">
                              <span className="font-mono text-gray-500 shrink-0">{t.startTime}–{t.endTime}</span>
                              <span className="font-semibold text-gray-800">{t.unitCode}</span>
                              {t.unitTitle && <span className="text-gray-400 hidden xl:inline">{t.unitTitle}</span>}
                              {t.departmentName && <span className="rounded-full bg-sky-100 text-sky-700 px-1.5 py-0.5">{t.departmentName}</span>}
                              {t.lecturerName && <span className="text-gray-500">{t.lecturerName}</span>}
                            </div>
                          ))}
                        </div>
                      </td>
                    </motion.tr>
                  ) : null,
                ].filter(Boolean);
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {showAdd && admin && (
          <AddRoomModal institutionId={admin.institutionId} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}
