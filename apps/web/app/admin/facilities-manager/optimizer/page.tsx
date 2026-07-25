"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  AlertTriangle,
  Clock,
  CalendarClock,
  BarChart2,
  Zap,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  X,
} from "lucide-react";

// ─── Auth helper ────────────────────────────────────────────────────────────
function getLocalAuth(): { token: string; institutionId: string } | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("facilitiesManagerToken");
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return { token, institutionId: payload.institutionId };
  } catch {
    return null;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────
type RoomType = "Lecture Hall" | "Lab" | "Tutorial Room" | "Seminar Room" | string;

interface Room {
  id: string;
  roomCode: string;
  buildingCode: string;
  name: string;
  capacity: number;
  type: RoomType;
  status: string;
  hasConflict?: boolean;
}

interface UtilizationRoom {
  roomId: string;
  roomCode: string;
  buildingCode: string;
  name: string;
  capacity: number;
  type: string;
  utilizationPct: number;
  hoursBooked: number;
  bookingCount: number;
}

interface ConflictEntry {
  id: string;
  startTime: string;
  endTime: string;
  unit: { id: string; code: string; title: string } | null;
  lecturer: { id: string; fullName: string } | null;
  course: { id: string; name: string } | null;
}

interface Conflict {
  type: "overlap" | "no_gap";
  room: { id: string; roomCode: string; buildingCode: string; name: string; capacity: number };
  day: string;
  entries: ConflictEntry[];
}

interface Booking {
  id: string;
  startAt: string;
  endAt: string;
  roomId: string;
  status: string;
}

// ─── Tab config ──────────────────────────────────────────────────────────────
const TABS = [
  { id: "finder", label: "Free Room Finder", icon: Search },
  { id: "underutilized", label: "Underutilized Rooms", icon: BarChart2 },
  { id: "heatmap", label: "Availability Heatmap", icon: CalendarClock },
  { id: "conflicts", label: "Conflict Scanner", icon: AlertTriangle },
  { id: "waste", label: "Capacity Waste", icon: Zap },
] as const;

type TabId = (typeof TABS)[number]["id"];

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 17 }, (_, i) => i + 7); // 7am – 11pm

const ROOM_TYPES = ["Lecture Hall", "Lab", "Tutorial Room", "Seminar Room", "Conference Room", "Studio"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function fmt12(hour: number) {
  const h = hour % 12 || 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    free: "bg-emerald-100 text-emerald-700",
    reserved: "bg-amber-100 text-amber-700",
    occupied: "bg-rose-100 text-rose-700",
    unavailable: "bg-slate-200 text-gray-500",
  };
  return map[status] ?? "bg-slate-100 text-gray-500";
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function OptimizerPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>("finder");
  const [auth, setAuth] = useState<{ token: string | null; institutionId: string } | null>(null);

  useEffect(() => {
    // Try localStorage token first (facilities manager direct login)
    const local = getLocalAuth();
    if (local) { setAuth(local); return; }
    // Fall back to cookie-based admin auth
    fetch("/api/auth/me", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.institutionId) setAuth({ token: null, institutionId: data.institutionId });
        else router.push("/admin/facilities-manager/login");
      })
      .catch(() => router.push("/admin/facilities-manager/login"));
  }, [router]);

  if (!auth) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="text-center">
          <Zap className="w-12 h-12 mx-auto mb-3 text-gray-700" />
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-gray-900 shadow">
          <Zap className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-gray-800">Optimizer</h1>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Discover free rooms, spot conflicts, and reduce wasted capacity
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-indigo-600 text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20"
                  : "border-transparent text-gray-500 hover:text-slate-900 dark:text-gray-500 dark:hover:text-gray-800"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-h-[400px]">
        {activeTab === "finder" && <FreeRoomFinder auth={auth} />}
        {activeTab === "underutilized" && <UnderutilizedRooms auth={auth} />}
        {activeTab === "heatmap" && <AvailabilityHeatmap auth={auth} />}
        {activeTab === "conflicts" && <ConflictScanner auth={auth} />}
        {activeTab === "waste" && <CapacityWasteReport auth={auth} />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Free Room Finder
// ════════════════════════════════════════════════════════════════════════════
function FreeRoomFinder({ auth }: { auth: { token: string | null; institutionId: string } }) {
  const todayDate = new Date().toISOString().slice(0, 10);
  const nowH = new Date().getHours();
  const defaultStart = `${String(nowH).padStart(2, "0")}:00`;
  const defaultEnd = `${String(Math.min(nowH + 2, 23)).padStart(2, "0")}:00`;

  const [date, setDate] = useState(todayDate);
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);
  const [capacity, setCapacity] = useState("");
  const [type, setType] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!date || !startTime || !endTime) return;
    setLoading(true);
    setError(null);
    try {
      const startAt = new Date(`${date}T${startTime}:00`).toISOString();
      const endAt = new Date(`${date}T${endTime}:00`).toISOString();
      const params = new URLSearchParams({
        institutionId: auth.institutionId,
        startAt,
        endAt,
        ...(capacity ? { capacity } : {}),
        ...(type ? { type } : {}),
      });
      const res = await fetch(`/api/rooms?${params}`);
      const data = await res.json();
      const allRooms: Room[] = data.data?.rooms ?? data.rooms ?? [];
      setRooms(allRooms.filter((r) => !r.hasConflict && r.status !== "unavailable"));
      setSearched(true);
    } catch {
      setError("Failed to fetch rooms. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h2 className="font-semibold text-slate-700 dark:text-gray-800 mb-4">Search Parameters</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Date</label>
            <input
              type="date"
              value={date}
              min={todayDate}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">End Time</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Min Capacity</label>
            <input
              type="number"
              min="1"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Any"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Room Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Any</option>
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
        <button
          onClick={search}
          disabled={loading}
          className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-gray-900 text-sm font-medium rounded-xl transition-colors shadow-sm"
        >
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Find Available Rooms
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {/* Results */}
      {searched && !loading && (
        <div>
          <p className="text-sm text-gray-400 mb-3">
            {rooms.length === 0
              ? "No available rooms found for the selected time window."
              : `${rooms.length} available room${rooms.length !== 1 ? "s" : ""} found`}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {rooms.map((room) => (
              <div
                key={room.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-gray-800 text-sm">
                      {room.roomCode}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">{room.name}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(room.status)}`}>
                    {room.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-3 text-xs text-gray-500 dark:text-gray-700">
                  <span className="flex items-center gap-1">
                    <span className="font-medium">{room.capacity}</span> seats
                  </span>
                  <span className="text-gray-700">·</span>
                  <span>{room.type}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Underutilized Rooms
// ════════════════════════════════════════════════════════════════════════════
function UnderutilizedRooms({ auth }: { auth: { token: string | null; institutionId: string } }) {
  const [rows, setRows] = useState<UtilizationRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/analytics?institutionId=${auth.institutionId}`);
      const data = await res.json();
      setRows((data.utilizationByRoom ?? []) as UtilizationRoom[]);
    } catch {
      setError("Failed to load utilization data.");
    } finally {
      setLoading(false);
    }
  }, [auth.institutionId]);

  useEffect(() => { load(); }, [load]);

  const filtered = rows.filter((r) => r.utilizationPct < threshold);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((r) => r.roomId)));
    }
  };

  const handleBulkUnavailable = async () => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/rooms/bulk-status", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        },
        body: JSON.stringify({ roomIds: Array.from(selected), status: "unavailable" }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error ?? "Bulk update failed.");
        return;
      }
      const data = await res.json();
      setSuccessMsg(`${data.updated} room${data.updated !== 1 ? "s" : ""} marked unavailable.`);
      setSelected(new Set());
      await load();
    } catch {
      setError("Failed to update rooms.");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkActivate = async () => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/rooms/bulk-status", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        },
        body: JSON.stringify({ roomIds: Array.from(selected), status: "free" }),
      });
      if (!res.ok) {
        const err = await res.json();
        setError(err.error ?? "Bulk update failed.");
        return;
      }
      const data = await res.json();
      setSuccessMsg(`${data.updated} room${data.updated !== 1 ? "s" : ""} returned to free.`);
      setSelected(new Set());
      await load();
    } catch {
      setError("Failed to update rooms.");
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-700">Utilization below</label>
          <input
            type="number"
            min={1}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-400">%</span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {selected.size > 0 && (
            <>
              <span className="text-xs text-gray-400">{selected.size} selected</span>
              <button
                onClick={handleBulkUnavailable}
                disabled={bulkLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-gray-900 text-xs font-medium rounded-lg transition-colors"
              >
                {bulkLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                Mark Unavailable
              </button>
              <button
                onClick={handleBulkActivate}
                disabled={bulkLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-gray-900 text-xs font-medium rounded-lg transition-colors"
              >
                Set Free
              </button>
            </>
          )}
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-100 text-gray-400 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-3 text-sm flex items-center justify-between">
          {successMsg}
          <button onClick={() => setSuccessMsg(null)}><X className="w-4 h-4" /></button>
        </div>
      )}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200">
                <th className="px-4 py-3 text-left">
                  <button onClick={toggleAll} className="text-gray-400 hover:text-indigo-600 transition-colors">
                    {selected.size === filtered.length && filtered.length > 0 ? (
                      <CheckSquare className="w-4 h-4" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-700">Room</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-700">Type</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-700">Capacity</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-700">Bookings</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-700">Hours Booked</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-700">Utilization</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-500 text-sm">
                    All rooms are above the {threshold}% utilization threshold. 
                  </td>
                </tr>
              ) : (
                filtered.map((room) => (
                  <tr
                    key={room.roomId}
                    className={`hover:bg-slate-50 dark:hover:bg-gray-100 transition-colors ${
                      selected.has(room.roomId) ? "bg-indigo-50/60 dark:bg-indigo-900/20" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <button onClick={() => toggle(room.roomId)} className="text-gray-500 hover:text-indigo-600 transition-colors">
                        {selected.has(room.roomId) ? (
                          <CheckSquare className="w-4 h-4 text-indigo-600" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 dark:text-gray-800">
                        {room.roomCode}
                      </p>
                      <p className="text-xs text-gray-500">{room.name}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-700">{room.type}</td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-700">{room.capacity}</td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-700">{room.bookingCount}</td>
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-700">{room.hoursBooked.toFixed(1)}h</td>
                    <td className="px-4 py-3 w-40">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-100 dark:bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-rose-400 to-amber-400"
                            style={{ width: `${Math.min(room.utilizationPct, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-700 w-10 text-right">
                          {room.utilizationPct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Availability Heatmap
// ════════════════════════════════════════════════════════════════════════════
function AvailabilityHeatmap({ auth }: { auth: { token: string | null; institutionId: string } }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string>("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [roomsLoading, setRoomsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/rooms?institutionId=${auth.institutionId}`);
        const data = await res.json();
        const roomsList = data.data?.rooms ?? data.rooms ?? [];
        setRooms(roomsList);
        if (roomsList.length > 0) setSelectedRoom(roomsList[0].id);
      } finally {
        setRoomsLoading(false);
      }
    })();
  }, [auth.institutionId]);

  useEffect(() => {
    if (!selectedRoom) return;
    setLoading(true);
    const now = new Date();
    const from = new Date(now.getTime() - 14 * 86_400_000).toISOString();
    const to = new Date(now.getTime() + 14 * 86_400_000).toISOString();
    fetch(`/api/bookings?institutionId=${auth.institutionId}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((data) => {
        const roomBookings = (data.bookings ?? []).filter(
          (b: Booking) => b.roomId === selectedRoom && b.status !== "cancelled"
        );
        setBookings(roomBookings);
      })
      .finally(() => setLoading(false));
  }, [selectedRoom, auth.institutionId]);

  // Build heatmap: day × hour → count
  const heat: Record<string, Record<number, number>> = {};
  for (const day of DAYS) {
    heat[day] = {};
    for (const h of HOURS) heat[day][h] = 0;
  }

  for (const booking of bookings) {
    const d = new Date(booking.startAt);
    const dayName = DAYS[d.getDay() === 0 ? 6 : d.getDay() - 1]; // Mon=0
    const startH = d.getHours();
    const endH = new Date(booking.endAt).getHours();
    for (let h = startH; h < endH && HOURS.includes(h); h++) {
      heat[dayName][h] = (heat[dayName][h] ?? 0) + 1;
    }
  }

  const maxCount = Math.max(1, ...Object.values(heat).flatMap((dh) => Object.values(dh)));

  const cell = (day: string, hour: number) => {
    const count = heat[day]?.[hour] ?? 0;
    const intensity = count / maxCount;
    // Color: empty=slate-100, low=indigo-100, mid=indigo-400, high=indigo-700
    let bg = "bg-slate-100 dark:bg-slate-700";
    if (intensity > 0) {
      if (intensity < 0.33) bg = "bg-indigo-100 dark:bg-indigo-900/50";
      else if (intensity < 0.66) bg = "bg-indigo-300 dark:bg-indigo-700";
      else bg = "bg-indigo-600 dark:bg-indigo-500";
    }
    return (
      <td key={`${day}-${hour}`} className="p-0.5">
        <div
          className={`w-full h-7 rounded ${bg} transition-colors group relative cursor-default`}
          title={`${day} ${fmt12(hour)}: ${count} booking${count !== 1 ? "s" : ""}`}
        >
          {count > 0 && (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-900 opacity-0 group-hover:opacity-100 transition-opacity">
              {count}
            </span>
          )}
        </div>
      </td>
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-4">
        <label className="text-sm text-gray-500 dark:text-gray-700 whitespace-nowrap">Select Room</label>
        {roomsLoading ? (
          <div className="h-9 w-48 bg-slate-100 dark:bg-slate-700 rounded-lg animate-pulse" />
        ) : (
          <select
            value={selectedRoom}
            onChange={(e) => setSelectedRoom(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm dark:bg-slate-700 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.roomCode} — {r.name}
              </option>
            ))}
          </select>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          <span className="w-3 h-3 rounded bg-slate-100 dark:bg-slate-700 inline-block" /> Empty
          <span className="w-3 h-3 rounded bg-indigo-200 inline-block" /> Low
          <span className="w-3 h-3 rounded bg-indigo-400 inline-block" /> Med
          <span className="w-3 h-3 rounded bg-indigo-600 inline-block" /> High
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm overflow-x-auto">
          <p className="text-xs text-gray-500 mb-3">Based on bookings in the past 14 days and upcoming 14 days</p>
          <table className="w-full" style={{ tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th className="w-24 text-xs text-gray-500 font-normal text-left pb-2">Day</th>
                {HOURS.map((h) => (
                  <th key={h} className="text-[10px] text-gray-500 font-normal text-center pb-2 px-0.5">
                    {fmt12(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day) => (
                <tr key={day}>
                  <td className="text-xs text-gray-400 dark:text-gray-500 font-medium pr-2 py-0.5 whitespace-nowrap">
                    {day.slice(0, 3)}
                  </td>
                  {HOURS.map((h) => cell(day, h))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Conflict Scanner
// ════════════════════════════════════════════════════════════════════════════
function ConflictScanner({ auth }: { auth: { token: string | null; institutionId: string } }) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<"all" | "overlap" | "no_gap">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/conflicts?institutionId=${auth.institutionId}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setConflicts(data.conflicts ?? []);
    } catch {
      setError("Failed to load conflict data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [auth.institutionId]);

  useEffect(() => { load(); }, [load]);

  const filtered = conflicts.filter((c) => filter === "all" || c.type === filter);
  const overlapCount = conflicts.filter((c) => c.type === "overlap").length;
  const noGapCount = conflicts.filter((c) => c.type === "no_gap").length;

  const toggleExpand = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          label="Total Conflicts"
          value={conflicts.length}
          color="rose"
          onClick={() => setFilter("all")}
          active={filter === "all"}
        />
        <SummaryCard
          label="Overlapping Slots"
          value={overlapCount}
          color="rose"
          onClick={() => setFilter("overlap")}
          active={filter === "overlap"}
        />
        <SummaryCard
          label="Tight Transitions (<10 min)"
          value={noGapCount}
          color="amber"
          onClick={() => setFilter("no_gap")}
          active={filter === "no_gap"}
        />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-700">
          {filter === "all" ? "All conflicts" : filter === "overlap" ? "Overlapping slots" : "Tight transitions"} — {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        </h2>
        <button onClick={load} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-100 text-gray-400 transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : filtered.length === 0 ? (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-8 text-center">
          <div className="text-3xl mb-2">✅</div>
          <p className="font-medium text-emerald-700 dark:text-emerald-600">No conflicts found</p>
          <p className="text-sm text-emerald-600 dark:text-emerald-500 mt-1">Your timetable is clean for the current filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((conflict, i) => (
            <div
              key={i}
              className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
                conflict.type === "overlap"
                  ? "border-rose-200 dark:border-rose-800"
                  : "border-amber-200 dark:border-amber-800"
              }`}
            >
              <button
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 dark:hover:bg-gray-100 transition-colors"
                onClick={() => toggleExpand(i)}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                      conflict.type === "overlap"
                        ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-600"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-600"
                    }`}
                  >
                    {conflict.type === "overlap" ? "OVERLAP" : "TIGHT"}
                  </span>
                  <span className="font-medium text-slate-800 dark:text-gray-800 text-sm">
                    {conflict.room.roomCode} — {conflict.room.name}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{conflict.day}</span>
                </div>
                {expanded.has(i) ? (
                  <ChevronUp className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-gray-500" />
                )}
              </button>

              {expanded.has(i) && (
                <div className="border-t border-slate-100 px-5 py-4 space-y-3">
                  {conflict.type === "overlap" ? (
                    <p className="text-xs text-rose-600 dark:text-rose-600 font-medium">
                      These two timetable entries overlap — only one can occupy the room at a time.
                    </p>
                  ) : (
                    <p className="text-xs text-amber-600 dark:text-amber-600 font-medium">
                      Less than 10 minutes between back-to-back sessions — insufficient turnaround time.
                    </p>
                  )}
                  {conflict.entries.map((entry, j) => (
                    <div
                      key={entry.id}
                      className="flex items-start gap-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3"
                    >
                      <span className="text-xs font-bold text-gray-500 mt-0.5">#{j + 1}</span>
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium text-slate-800 dark:text-gray-800">
                          {entry.startTime} – {entry.endTime}
                        </p>
                        {entry.unit && (
                          <p className="text-xs text-gray-400 dark:text-gray-500">
                            {entry.unit.code}: {entry.unit.title}
                          </p>
                        )}
                        {entry.lecturer && (
                          <p className="text-xs text-gray-400 dark:text-gray-500">
                            Lecturer: {entry.lecturer.fullName}
                          </p>
                        )}
                        {entry.course && (
                          <p className="text-xs text-gray-500">{entry.course.name}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Capacity Waste Report
// ════════════════════════════════════════════════════════════════════════════
function CapacityWasteReport({ auth }: { auth: { token: string | null; institutionId: string } }) {
  const [rows, setRows] = useState<UtilizationRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [utilizationThreshold, setUtilizationThreshold] = useState(30);
  const [capacityThreshold, setCapacityThreshold] = useState(50);
  const [sortKey, setSortKey] = useState<"utilizationPct" | "capacity" | "waste">("waste");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/bookings/analytics?institutionId=${auth.institutionId}`);
        const data = await res.json();
        setRows(data.utilizationByRoom ?? []);
      } catch {
        setError("Failed to load analytics data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [auth.institutionId]);

  // "waste score" = capacity × (1 - utilization/100)
  const wasteScore = (r: UtilizationRoom) => r.capacity * (1 - r.utilizationPct / 100);

  const filtered = rows
    .filter((r) => r.utilizationPct < utilizationThreshold && r.capacity >= capacityThreshold)
    .sort((a, b) => {
      if (sortKey === "utilizationPct") return a.utilizationPct - b.utilizationPct;
      if (sortKey === "capacity") return b.capacity - a.capacity;
      return wasteScore(b) - wasteScore(a);
    });

  const totalWastedSeats = filtered.reduce((s, r) => s + Math.round(r.capacity * (1 - r.utilizationPct / 100)), 0);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center gap-5">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-700 whitespace-nowrap">Utilization &lt;</label>
          <input
            type="number"
            min={1}
            max={100}
            value={utilizationThreshold}
            onChange={(e) => setUtilizationThreshold(Number(e.target.value))}
            className="w-16 border border-slate-300 rounded-lg px-2 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-400">%</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500 dark:text-gray-700 whitespace-nowrap">Capacity ≥</label>
          <input
            type="number"
            min={1}
            value={capacityThreshold}
            onChange={(e) => setCapacityThreshold(Number(e.target.value))}
            className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-400">seats</span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-gray-400">Sort by</label>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm dark:bg-slate-700 dark:text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="waste">Waste Score</option>
            <option value="utilizationPct">Utilization</option>
            <option value="capacity">Capacity</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
            <p className="text-xs text-amber-600 dark:text-amber-600 font-medium uppercase tracking-wide">Rooms Below Threshold</p>
            <p className="text-3xl font-bold text-amber-700 dark:text-amber-700 mt-1">{filtered.length}</p>
          </div>
          <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-2xl p-4">
            <p className="text-xs text-rose-600 dark:text-rose-600 font-medium uppercase tracking-wide">Estimated Wasted Seat-Cycles</p>
            <p className="text-3xl font-bold text-rose-700 dark:text-rose-700 mt-1">{totalWastedSeats.toLocaleString()}</p>
          </div>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : filtered.length === 0 ? (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-8 text-center">
          <div className="text-3xl mb-2">✅</div>
          <p className="font-medium text-emerald-700 dark:text-emerald-600">No wastage detected</p>
          <p className="text-sm text-emerald-600 dark:text-emerald-500 mt-1">
            No large rooms fall below the {utilizationThreshold}% threshold.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((room) => {
            const waste = wasteScore(room);
            const suggestion =
              room.capacity >= 200
                ? "Consider splitting into two medium-sized rooms"
                : room.capacity >= 100
                ? "A smaller lecture hall (~50–80 seats) may be sufficient"
                : room.capacity >= 50
                ? "Consider a seminar room or tutorial room instead"
                : "Review scheduling or repurpose the space";
            return (
              <div
                key={room.roomId}
                className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-gray-800">
                    {room.roomCode}
                    <span className="ml-2 text-xs font-normal text-gray-500">{room.name}</span>
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    {room.type} · {room.capacity} seats · {room.bookingCount} booking{room.bookingCount !== 1 ? "s" : ""} · {room.hoursBooked.toFixed(1)}h booked
                  </p>
                </div>
                <div className="flex items-center gap-6 shrink-0">
                  <div className="text-center">
                    <p className="text-xs text-gray-500">Utilization</p>
                    <p className="text-lg font-bold text-rose-600">{room.utilizationPct.toFixed(1)}%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-500">Waste Score</p>
                    <p className="text-lg font-bold text-amber-600">{Math.round(waste)}</p>
                  </div>
                </div>
                <div className="sm:max-w-xs bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2">
                  <p className="text-xs text-amber-700 dark:text-amber-600">
                    <span className="font-semibold">Suggestion: </span>{suggestion}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────────────
function SummaryCard({
  label,
  value,
  color,
  onClick,
  active,
}: {
  label: string;
  value: number;
  color: "rose" | "amber" | "indigo";
  onClick?: () => void;
  active?: boolean;
}) {
  const colorMap = {
    rose: "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-700",
    amber: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-700",
    indigo: "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-700",
  };
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition-all ${colorMap[color]} ${
        active ? "ring-2 ring-offset-1 ring-indigo-500" : "hover:shadow-sm"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </button>
  );
}

function LoadingSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-100 p-4 animate-pulse">
          <div className="flex gap-4">
            <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-1/4" />
            <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-1/3" />
            <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-1/5 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}
