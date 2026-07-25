"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar, Search, Plus, X, Loader2, Users,
  Clock, BookOpen, MapPin, GraduationCap,
  LayoutGrid, List, CheckCircle2, RefreshCw,
  Filter, ChevronDown, Zap, Building2, AlertCircle, Trash2,
} from "lucide-react";
import Link from "next/link";
import { useDepartmentAdmin } from "../../context";

// ─── Types ────────────────────────────────────────────────────────────────

interface Entry {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  unitCode?: string;
  unitTitle?: string;
  venueName?: string;
  roomId?: string;
  roomName?: string;
  status: string;
  lecturerName?: string;
  lecturerId?: string;
  courseName?: string;
  courseId?: string;
  departmentId?: string;
  semester?: string;
  yearOfStudy?: string;
  unitId?: string;
  mergeGroupId?: string | null;
}

interface CourseUnit { id: string; code: string; title: string }
interface CourseSem { id: string; label: string; units: CourseUnit[] }
interface CourseYear { id: string; name: string; semesters: CourseSem[] }
interface Course { id: string; name: string; departmentId: string; years: CourseYear[] }
interface Unit { id: string; code: string; title: string }
interface Lecturer { id: string; fullName: string }
interface Room { id: string; name: string; roomCode: string; capacity: number; status?: string }

interface MergeEntry {
  id: string;
  departmentName: string;
  courseName: string;
  courseCode: string;
  unitCode: string;
  unitTitle: string;
  lecturerName: string;
  roomName: string;
  roomCode: string;
  roomCapacity: number | null;
  day: string;
  startTime: string;
  endTime: string;
  yearOfStudy?: string;
  semester?: string;
  status: string;
  studentCount: number;
}

interface CacheEntry {
  courses: Course[];
  units: Unit[];
  lecturers: Lecturer[];
  timestamp: number;
}

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const DAY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Monday:    { bg: "bg-indigo-500",  text: "text-indigo-600",  dot: "bg-indigo-500"  },
  Tuesday:   { bg: "bg-violet-500",  text: "text-violet-600",  dot: "bg-violet-500"  },
  Wednesday: { bg: "bg-cyan-500",    text: "text-cyan-600",    dot: "bg-cyan-500"    },
  Thursday:  { bg: "bg-teal-500",    text: "text-teal-600",    dot: "bg-teal-500"    },
  Friday:    { bg: "bg-orange-500",  text: "text-orange-600",  dot: "bg-orange-500"  },
  Saturday:  { bg: "bg-pink-500",    text: "text-pink-600",    dot: "bg-pink-500"    },
};

const STATUS_META: Record<string, { pill: string; dot: string }> = {
  Confirmed: { pill: "bg-emerald-50 text-emerald-700 border border-emerald-200", dot: "bg-emerald-500" },
  Pending:   { pill: "bg-amber-50   text-amber-700   border border-amber-200",   dot: "bg-amber-500"   },
  Cancelled: { pill: "bg-red-50     text-red-700     border border-red-200",     dot: "bg-red-400"     },
};

const TIME_SLOTS = Array.from({ length: 14 }, (_, i) => `${String(i + 7).padStart(2, "0")}:00`);

const EMPTY_FORM = {
  courseId: "", yearId: "", semesterId: "", unitId: "",
  lecturerId: "", roomId: "", venueName: "",
  day: "Monday", startTime: "08:00", endTime: "10:00",
};

const inp = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition disabled:opacity-40 disabled:cursor-not-allowed";
const lbl = "block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide";

function Req() {
  return <span className="ml-0.5 font-normal normal-case text-red-400">*</span>;
}

function SectionHeader({ num, label, done }: { num: number; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all ${
        done ? "bg-emerald-100 text-emerald-600" : "bg-indigo-100 text-indigo-600"
      }`}>
        {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : num}
      </div>
      <p className={`text-xs font-bold uppercase tracking-wider ${done ? "text-emerald-600" : "text-gray-600"}`}>
        {label}
      </p>
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────

function timeToMins(t: string) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function formatDuration(mins: number) {
  if (mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function buildWindowTimestamps(dayName: string, startTime: string, endTime: string) {
  const DAY_IDX: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  };
  const target = DAY_IDX[dayName] ?? 1;
  const now = new Date();
  const todayUTC = now.getUTCDay();
  let daysAhead = (target - todayUTC + 7) % 7;
  if (daysAhead === 0) daysAhead = 7;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const base = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead,
  ));
  const startAt = new Date(base); startAt.setUTCHours(sh, sm, 0, 0);
  const endAt   = new Date(base); endAt.setUTCHours(eh, em, 0, 0);
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function DeptTimetablePage() {
  const admin = useDepartmentAdmin();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState("Monday");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"list" | "grid">("list");
  const [statusFilter, setStatusFilter] = useState("all");

  // ── OPTIMIZATION: Data caching ─────────────────────────────────────────────
  const [dataCache, setDataCache] = useState<CacheEntry | null>(null);
  const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

  // Modal state
  const [showModal, setShowModal]           = useState(false);
  const [form, setForm]                     = useState({ ...EMPTY_FORM });
  const [courses, setCourses]               = useState<Course[]>([]);
  const [units, setUnits]                   = useState<Unit[]>([]);
  const [lecturers, setLecturers]           = useState<Lecturer[]>([]);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [modalLoading, setModalLoading]     = useState(false);
  const [roomsLoading, setRoomsLoading]     = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [submitError, setSubmitError]       = useState<string | null>(null);
  const [mergeConflict, setMergeConflict]   = useState<{ conflictId: string; message: string } | null>(null);

  // ── OPTIMIZATION: Session tracking ────────────────────────────────────────
  const [entriesAddedInSession, setEntriesAddedInSession] = useState(0);
  const [lastSuccessMessage, setLastSuccessMessage] = useState<string | null>(null);

  // Delete state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting]               = useState(false);

  // Joint-class detail drawer
  const [drawerGroupId, setDrawerGroupId]     = useState<string | null>(null);
  const [drawerEntries, setDrawerEntries]     = useState<MergeEntry[]>([]);
  const [drawerTotal, setDrawerTotal]         = useState<number>(0);
  const [drawerLoading, setDrawerLoading]     = useState(false);

  // ── OPTIMIZATION: Debounce timer for room fetching ─────────────────────────
  const roomFetchTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchEntries = useCallback(async () => {
    if (!admin?.departmentId) return;
    setLoading(true);
    const data = await fetch(`/api/timetable?departmentId=${admin.departmentId}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : []) as any;
    setEntries(Array.isArray(data) ? data : data.entries ?? data.data ?? []);
    setLoading(false);
  }, [admin?.departmentId]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const todayName = DAYS[new Date().getDay() - 1] ?? "Monday";
  useEffect(() => { setActiveDay(todayName); }, [todayName]);

  const openMergeDrawer = useCallback(async (groupId: string) => {
    setDrawerGroupId(groupId);
    setDrawerLoading(true);
    setDrawerEntries([]);
    try {
      const res = await fetch(`/api/timetable/merge-group/${groupId}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setDrawerEntries(data.entries ?? []);
      setDrawerTotal(data.totalStudents ?? 0);
    } catch (err) {
      console.error("[drawer] fetchMergeGroup error:", err);
    } finally {
      setDrawerLoading(false);
    }
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerGroupId(null);
    setDrawerEntries([]);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/timetable/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setEntries(prev => prev.filter(e => e.id !== id));
        setDeleteConfirmId(null);
      } else {
        const d = await res.json().catch(() => ({}));
        console.error("[timetable] delete failed:", d.error ?? res.status);
      }
    } catch (err) {
      console.error("[timetable] delete error:", err);
    } finally {
      setDeleting(false);
    }
  }, []);

  // ── OPTIMIZATION: Fetch with cache check ───────────────────────────────────
  const openModal = useCallback(async () => {
    if (!admin?.departmentId) return;
    setForm({ ...EMPTY_FORM });
    setSubmitError(null);
    setMergeConflict(null);
    setAvailableRooms([]);
    setShowModal(true);

    // Check cache validity
    const now = Date.now();
    if (dataCache && (now - dataCache.timestamp) < CACHE_TTL) {
      // Use cached data
      setCourses(dataCache.courses);
      setUnits(dataCache.units);
      setLecturers(dataCache.lecturers);
      return; // No need for setModalLoading since we already have data
    }

    // Cache miss or expired, fetch fresh data
    setModalLoading(true);
    try {
      const [c, u, l] = await Promise.all([
        fetch(`/api/courses?departmentId=${admin.departmentId}`, { credentials: "include" })
          .then(r => r.ok ? r.json() : {}).catch(() => ({})),
        fetch(`/api/units?departmentId=${admin.departmentId}`, { credentials: "include" })
          .then(r => r.ok ? r.json() : {}).catch(() => ({})),
        fetch(`/api/lecturers?departmentId=${admin.departmentId}`, { credentials: "include" })
          .then(r => r.ok ? r.json() : []).catch(() => []),
      ]);
      const coursesData = Array.isArray(c) ? c : ((c as any).courses ?? (c as any).data ?? []);
      const unitsData = Array.isArray(u) ? u : ((u as any).units ?? (u as any).data ?? []);
      const lecturersData = Array.isArray(l) ? l : ((l as any).lecturers ?? (l as any).data ?? []);
      
      setCourses(coursesData);
      setUnits(unitsData);
      setLecturers(lecturersData);
      
      // Cache the data
      setDataCache({
        courses: coursesData,
        units: unitsData,
        lecturers: lecturersData,
        timestamp: now,
      });
    } catch (err) {
      console.error("[timetable] openModal fetch error:", err);
    } finally {
      setModalLoading(false);
    }
  }, [admin?.departmentId, dataCache]);

  // ── OPTIMIZATION: Debounced room fetching ──────────────────────────────────
  const fetchAvailableRooms = useCallback(async (day: string, startTime: string, endTime: string) => {
    if (!admin?.institutionId || !day || !startTime || !endTime) return;
    if (startTime >= endTime) return;

    // Clear previous timer
    if (roomFetchTimerRef.current) clearTimeout(roomFetchTimerRef.current);

    // Set new debounced timer (400ms)
    roomFetchTimerRef.current = setTimeout(async () => {
      setRoomsLoading(true);
      setAvailableRooms([]);
      try {
        const { startAt, endAt } = buildWindowTimestamps(day, startTime, endTime);
        const url = `/api/rooms?institutionId=${admin.institutionId}&startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return;
        const payload = await res.json();
        const raw: any[] = Array.isArray(payload) ? payload : (payload?.data?.rooms ?? payload?.rooms ?? []);
        const free = raw.filter(r => !r.status || r.status === "free" || r.status === "available");
        setAvailableRooms(free.map(r => ({
          id: r.id,
          name: r.name,
          roomCode: r.roomCode ?? r.room_code ?? "",
          capacity: r.capacity ?? 0,
          status: r.status,
        })));
      } catch (err) {
        console.error("[timetable] fetchAvailableRooms error:", err);
      } finally {
        setRoomsLoading(false);
      }
    }, 400); // 400ms debounce
  }, [admin?.institutionId]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (roomFetchTimerRef.current) clearTimeout(roomFetchTimerRef.current);
    };
  }, []);

  const handleChange = useCallback((field: string, value: string) => {
    // Any form edit invalidates a pending conflict — the slot has changed
    setMergeConflict(null);
    setSubmitError(null);
    setForm(prev => {
      const next = { ...prev, [field]: value };

      // Cascade resets for scope fields
      if (field === "courseId") { next.yearId = ""; next.semesterId = ""; next.unitId = ""; }
      else if (field === "yearId")     { next.semesterId = ""; next.unitId = ""; }
      else if (field === "semesterId") { next.unitId = ""; }

      // Reset room when time/day changes
      if (field === "day" || field === "startTime" || field === "endTime") {
        next.roomId = "";
        next.venueName = "";
      }

      // Auto-fill venueName when room is selected
      if (field === "roomId" && value) {
        const room = availableRooms.find(r => r.id === value);
        if (room) next.venueName = `${room.roomCode} – ${room.name}`;
      }

      return next;
    });
  }, [availableRooms]);

  useEffect(() => {
    if (showModal && form.day && form.startTime && form.endTime && form.startTime < form.endTime) {
      fetchAvailableRooms(form.day, form.startTime, form.endTime);
    }
  }, [showModal, form.day, form.startTime, form.endTime, fetchAvailableRooms]);

  // ── OPTIMIZATION: Smart form reset after successful submission ──────────────
  const resetFormAfterSuccess = useCallback(() => {
    // Keep courseId, yearId, semesterId, lecturerId, day, startTime, endTime so
    // batch entry at the same scope/time-slot only needs a new unit + room pick.
    setForm(prev => ({
      ...prev,
      unitId: "",
      roomId: "",
      venueName: "",
    }));
  }, []);

  const handleSubmit = async (e: React.FormEvent, mode: "submit" | "submitAndAdd" = "submit") => {
    e.preventDefault();
    if (!form.courseId || !form.yearId || !form.semesterId || !form.unitId ||
        !form.lecturerId || !form.roomId) {
      setSubmitError("Please fill in all required fields."); return;
    }
    if (form.startTime >= form.endTime) {
      setSubmitError("End time must be after start time."); return;
    }
    setSubmitting(true); setSubmitError(null); setLastSuccessMessage(null);
    try {
      const year     = yearsForCourse.find(y => y.id === form.yearId);
      const semObj   = year?.semesters.find(s => s.id === form.semesterId);
      const yearOfStudy = year?.name ?? "";
      const semester    = semObj?.label ?? "";
      const unit   = filteredUnits.find(u => u.id === form.unitId) ??
                     units.find(u => u.id === form.unitId);
      const res = await fetch("/api/timetable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          courseId:    form.courseId,
          departmentId: admin!.departmentId,
          institutionId: admin!.institutionId,
          unitId:      form.unitId,
          lecturerId:  form.lecturerId,
          roomId:      form.roomId,
          day:         form.day,
          startTime:   form.startTime,
          endTime:     form.endTime,
          venueName:   form.venueName,
          semester:    semester || null,
          yearOfStudy: yearOfStudy || null,
          unitCode:    unit?.code ?? "",
        }),
      });
      if (res.status === 409) {
        const d = await res.json();
        if (d.mergePrompt && d.conflictId) {
          setMergeConflict({
            conflictId: d.conflictId,
            message: d.message ?? "This unit is already scheduled at this time by another department.",
          });
          return;
        }
        setSubmitError(d.message ?? d.error ?? "Time slot conflict — please review.");
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSubmitError(d.error ?? `Error ${res.status}`);
        return;
      }

      // ── SUCCESS ────────────────────────────────────────────────────────
      const newCount = entriesAddedInSession + 1;
      setEntriesAddedInSession(newCount);
      setLastSuccessMessage(`✓ Entry created (${newCount} this session)`);

      // Optimistic local insert — avoids a full fetchEntries() round-trip.
      // The server returns the created row; we enrich it with names from local state.
      const created = await res.json();
      const lecturerObj = lecturers.find(l => l.id === form.lecturerId);
      const courseObj   = courses.find(c => c.id === form.courseId);
      const roomObj     = availableRooms.find(r => r.id === form.roomId);
      setEntries(prev => [...prev, {
        id:           created.id,
        day:          created.day,
        startTime:    created.startTime,
        endTime:      created.endTime,
        unitCode:     unit?.code ?? "",
        unitTitle:    unit?.title ?? "",
        venueName:    created.venueName ?? form.venueName,
        roomId:       created.roomId,
        roomName:     roomObj?.name,
        status:       created.status ?? "Pending",
        lecturerName: lecturerObj?.fullName,
        lecturerId:   created.lecturerId,
        courseName:   courseObj?.name,
        courseId:     created.courseId,
        departmentId: created.departmentId,
        semester:     created.semester ?? semester,
        yearOfStudy:  created.yearOfStudy ?? yearOfStudy,
        unitId:       created.unitId,
        mergeGroupId: null,
      }]);

      if (mode === "submitAndAdd") {
        // Keep modal open, reset form intelligently
        resetFormAfterSuccess();
        // Clear any old messages after 2 seconds
        setTimeout(() => setLastSuccessMessage(null), 2000);
      } else {
        // Close modal
        setShowModal(false);
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? "Failed to create entry.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMerge = async () => {
    if (!mergeConflict || !admin) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const year     = yearsForCourse.find(y => y.id === form.yearId);
      const semObj   = year?.semesters.find(s => s.id === form.semesterId);
      const yearOfStudy = year?.name ?? "";
      const semester    = semObj?.label ?? "";
      const res = await fetch(`/api/timetable/${mergeConflict.conflictId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          departmentId: admin.departmentId,
          courseId:     form.courseId,
          lecturerId:   form.lecturerId || undefined,
          yearOfStudy:  yearOfStudy || undefined,
          semester:     semester || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSubmitError(d.error ?? `Merge failed (${res.status})`);
        setMergeConflict(null);
        return;
      }
      setMergeConflict(null);
      setEntriesAddedInSession(prev => prev + 1);
      setLastSuccessMessage(`✓ Joint class created (${entriesAddedInSession + 1} this session)`);
      await fetchEntries();
      setTimeout(() => setLastSuccessMessage(null), 2000);
      resetFormAfterSuccess();
    } catch (err: any) {
      setSubmitError(err?.message ?? "Merge failed.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Derived lists (memoized) ───────────────────────────────────────────────
  const yearsForCourse = useMemo(() => {
    if (!form.courseId) return [];
    return courses.find(c => c.id === form.courseId)?.years ?? [];
  }, [courses, form.courseId]);

  const semestersForYear = useMemo(() => {
    if (!form.yearId) return [];
    return yearsForCourse.find(y => y.id === form.yearId)?.semesters ?? [];
  }, [yearsForCourse, form.yearId]);

  const filteredUnits = useMemo(() => {
    if (!form.semesterId) return [];
    const semUnits = semestersForYear.find(s => s.id === form.semesterId)?.units ?? [];
    if (semUnits.length > 0) return semUnits;
    return units;
  }, [semestersForYear, form.semesterId, units]);

  const shown = useMemo(() =>
    entries
      .filter(e => e.day === activeDay)
      .filter(e => statusFilter === "all" || e.status === statusFilter)
      .filter(e => !search ||
        (e.unitCode  ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (e.unitTitle ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (e.lecturerName ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (e.courseName ?? "").toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [entries, activeDay, statusFilter, search]);

  const daySummary = useMemo(() =>
    DAYS.map(d => ({ day: d, count: entries.filter(e => e.day === d).length })),
    [entries]);

  const stats = useMemo(() => ({
    total:      entries.length,
    confirmed:  entries.filter(e => e.status === "Confirmed").length,
    jointCount: new Set(entries.filter(e => e.mergeGroupId).map(e => e.mergeGroupId)).size,
    uniqueUnits: new Set(entries.map(e => e.unitCode)).size,
  }), [entries]);

  const timeSlotReady = form.day && form.startTime && form.endTime && form.startTime < form.endTime;

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Timetable</h1>
          <p className="text-sm text-gray-400 mt-0.5 flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            {admin?.departmentName ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchEntries}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <Link
            href="/admin/department-admin/dashboard/timetable/new"
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200 transition"
          >
            <Plus className="h-4 w-4" /> New Entry
          </Link>
        </div>
      </div>

      {/* ── Stats row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Sessions",  value: stats.total,       icon: Calendar,     color: "text-indigo-600",  bg: "bg-indigo-50"  },
          { label: "Confirmed",       value: stats.confirmed,   icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Joint Classes",   value: stats.jointCount,  icon: Users,        color: "text-violet-600",  bg: "bg-violet-50"  },
          { label: "Unique Units",    value: stats.uniqueUnits, icon: BookOpen,     color: "text-cyan-600",    bg: "bg-cyan-50"    },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</span>
              <span className={`rounded-lg ${bg} p-1.5`}><Icon className={`h-3.5 w-3.5 ${color}`} /></span>
            </div>
            <p className="text-2xl font-bold text-gray-900">{loading ? "—" : value}</p>
          </div>
        ))}
      </div>

      {/* ── Week bar (day selector) ──────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {daySummary.map(({ day, count }) => {
            const isActive = activeDay === day;
            const isToday  = day === todayName;
            const col = DAY_COLORS[day] ?? DAY_COLORS.Monday;
            return (
              <button
                key={day}
                onClick={() => setActiveDay(day)}
                className={`flex flex-col items-center gap-1 rounded-xl px-4 py-2.5 transition-all min-w-[68px] flex-1 ${
                  isActive ? `${col.bg} text-white shadow-md` : "hover:bg-gray-50 text-gray-500"
                }`}
              >
                <span className={`text-[10px] font-bold uppercase tracking-widest ${isActive ? "text-white/80" : isToday ? col.text : "text-gray-400"}`}>
                  {day.slice(0, 3)}
                </span>
                <span className={`text-lg font-bold leading-none ${isActive ? "text-white" : "text-gray-800"}`}>{count}</span>
                {isToday && !isActive && <span className={`h-1 w-1 rounded-full ${col.dot}`} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search units, lecturers, courses…"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 pl-9 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-300 transition"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {/* View toggle */}
        <div className="flex rounded-xl border border-gray-200 bg-white p-1 gap-0.5 shrink-0">
          {(["list","grid"] as const).map(t => (
            <button
              key={t} onClick={() => setActiveTab(t)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${activeTab === t ? "bg-indigo-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              {t === "list" ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
              {t === "list" ? "List" : "Grid"}
            </button>
          ))}
        </div>
        {/* Status filter */}
        <div className="relative shrink-0">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
          <select
            value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="appearance-none rounded-xl border border-gray-200 bg-white pl-8 pr-7 py-2 text-xs font-medium text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            <option value="all">All status</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Pending">Pending</option>
            <option value="Cancelled">Cancelled</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* ── Day heading ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className={`h-2.5 w-2.5 rounded-full ${DAY_COLORS[activeDay]?.dot ?? "bg-indigo-500"}`} />
        <h2 className="text-base font-bold text-gray-800">{activeDay}</h2>
        <span className="text-sm text-gray-400">{shown.length} session{shown.length !== 1 ? "s" : ""}</span>
        {activeDay === todayName && (
          <span className="flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 uppercase tracking-wide">
            <Zap className="h-2.5 w-2.5" /> Today
          </span>
        )}
      </div>

      {/* ── List view ─────────────────────────────────────────────────────── */}
      {activeTab === "list" && (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeDay + "list"}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm"
          >
            {loading ? (
              <div className="p-5 space-y-3">
                {[1,2,3,4].map(i => (
                  <div key={i} className="flex gap-3 items-center">
                    <div className="h-12 w-16 rounded-xl bg-gray-100 animate-pulse shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 bg-gray-100 rounded animate-pulse w-1/3" />
                      <div className="h-3 bg-gray-100 rounded animate-pulse w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : shown.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <div className="rounded-2xl bg-gray-50 p-4"><Calendar className="h-8 w-8 text-gray-300" /></div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-700">No sessions scheduled</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {search ? `No results for "${search}"` : `Nothing on ${activeDay} yet`}
                  </p>
                </div>
                {!search && (
                  <Link href="/admin/department-admin/dashboard/timetable/new" className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:underline mt-1">
                    <Plus className="h-3.5 w-3.5" /> Add first entry
                  </Link>
                )}
              </div>
            ) : (
              <div>
                {/* Column headers */}
                <div className="hidden sm:grid sm:grid-cols-[80px_1fr_160px_130px_150px] gap-4 px-5 py-2.5 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50/60">
                  <span>Time</span><span>Unit / Course</span><span>Lecturer</span><span>Room</span><span className="text-right">Status</span>
                </div>
                {shown.map((e, i) => {
                  const col = DAY_COLORS[e.day] ?? DAY_COLORS.Monday;
                  const st  = STATUS_META[e.status] ?? STATUS_META.Pending;
                  const durationMins = timeToMins(e.endTime) - timeToMins(e.startTime);
                  const isConfirmingDelete = deleteConfirmId === e.id;
                  return (
                    <motion.div
                      key={e.id}
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03, duration: 0.2 }}
                      className="group grid grid-cols-1 sm:grid-cols-[80px_1fr_160px_130px_150px] gap-2 sm:gap-4 items-center px-5 py-4 border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60 transition-colors"
                    >
                      {/* Time */}
                      <div className="flex sm:flex-col gap-2 sm:gap-0.5">
                        <span className="text-xs font-bold text-gray-800 font-mono">{e.startTime}</span>
                        <span className="text-[10px] text-gray-400 font-mono hidden sm:block">{e.endTime}</span>
                        <span className="text-[10px] text-gray-400 sm:hidden">– {e.endTime}</span>
                        <span className="hidden sm:block text-[10px] font-medium text-indigo-500 bg-indigo-50 rounded-md px-1 py-0.5 w-fit mt-0.5">
                          {formatDuration(durationMins)}
                        </span>
                      </div>
                      {/* Unit */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`hidden sm:flex h-9 w-9 shrink-0 rounded-xl ${col.bg} items-center justify-center`}>
                          <BookOpen className="h-4 w-4 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{e.unitCode ?? "—"}</p>
                          <p className="text-xs text-gray-400 truncate">{e.unitTitle ?? e.courseName ?? "—"}</p>
                          {e.yearOfStudy && (
                            <p className="text-[10px] text-indigo-500 font-medium mt-0.5">{e.yearOfStudy} · {e.semester ?? ""}</p>
                          )}
                        </div>
                      </div>
                      {/* Lecturer */}
                      <div className="hidden sm:flex items-center gap-2 min-w-0">
                        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center shrink-0 text-[10px] font-bold text-slate-600">
                          {(e.lecturerName ?? "?").charAt(0)}
                        </div>
                        <span className="text-xs text-gray-600 truncate">{e.lecturerName ?? "—"}</span>
                      </div>
                      {/* Room */}
                      <div className="hidden sm:flex items-center gap-1.5 min-w-0">
                        <MapPin className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                        <span className="text-xs text-gray-500 truncate">{e.venueName ?? e.roomName ?? "—"}</span>
                      </div>
                      {/* Status + Joint + Delete */}
                      <div className="hidden sm:flex items-center justify-end gap-1.5 flex-wrap">
                        {e.mergeGroupId && (
                          <button
                            onClick={() => openMergeDrawer(e.mergeGroupId!)}
                            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 transition"
                          >
                            <Users className="h-2.5 w-2.5" /> Joint
                          </button>
                        )}
                        <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.pill}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                          {e.status}
                        </span>
                        {/* Delete */}
                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(e.id)}
                              disabled={deleting}
                              className="rounded-lg bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-red-600 disabled:opacity-50 transition"
                            >
                              {deleting ? "…" : "Yes"}
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="rounded-lg border border-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-100 transition"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(e.id)}
                            className="rounded-lg p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100"
                            title="Delete entry"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* ── Grid View ───────────────────────────────────────────────────────– */}
      {activeTab === "grid" && (
        <AnimatePresence mode="wait">
          <motion.div
            key={activeDay + "grid"}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm"
          >
            {loading ? (
              <div className="p-5 h-40 flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  {/* Time header */}
                  <div className="grid border-b border-gray-100 bg-gray-50/70"
                    style={{ gridTemplateColumns: `64px repeat(${TIME_SLOTS.length}, 1fr)` }}>
                    <div className="px-2 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Day</div>
                    {TIME_SLOTS.map(t => (
                      <div key={t} className="px-1 py-2.5 text-[10px] font-mono font-bold text-gray-400 text-center border-l border-gray-100">{t}</div>
                    ))}
                  </div>
                  {/* Day rows */}
                  {DAYS.map(day => {
                    const col = DAY_COLORS[day] ?? DAY_COLORS.Monday;
                    const dayEntries = entries
                      .filter(e => e.day === day)
                      .filter(e => statusFilter === "all" || e.status === statusFilter);
                    return (
                      <div key={day}
                        className={`grid border-b border-gray-100 last:border-b-0 min-h-[56px] ${day === activeDay ? "bg-indigo-50/30" : ""}`}
                        style={{ gridTemplateColumns: `64px repeat(${TIME_SLOTS.length}, 1fr)` }}>
                        <div
                          className={`flex flex-col items-center justify-center px-1 py-2 cursor-pointer transition ${day === activeDay ? "" : "hover:bg-gray-50"}`}
                          onClick={() => setActiveDay(day)}
                        >
                          <span className={`text-[9px] font-bold uppercase tracking-widest ${day === activeDay ? col.text : "text-gray-400"}`}>{day.slice(0, 3)}</span>
                          <span className={`text-xs font-bold ${day === activeDay ? col.text : "text-gray-500"}`}>{dayEntries.length}</span>
                          {day === todayName && <span className={`mt-0.5 h-1 w-1 rounded-full ${col.dot}`} />}
                        </div>
                        {TIME_SLOTS.map((slot) => {
                          const slotMins = timeToMins(slot);
                          const slotEntries = dayEntries.filter(e => {
                            const s = timeToMins(e.startTime);
                            return s >= slotMins && s < slotMins + 60;
                          });
                          return (
                            <div key={slot} className="relative border-l border-gray-100 py-1 px-0.5">
                              {slotEntries.map(e => {
                                const st = STATUS_META[e.status] ?? STATUS_META.Pending;
                                return (
                                  <div key={e.id}
                                    title={`${e.unitCode} – ${e.lecturerName} (${e.startTime}–${e.endTime})`}
                                    className={`rounded-md px-1.5 py-1 mb-0.5 cursor-pointer hover:opacity-80 transition border ${st.pill} overflow-hidden`}
                                  >
                                    <p className="text-[9px] font-bold truncate leading-tight">{e.unitCode}</p>
                                    <p className="text-[8px] text-gray-500 truncate leading-tight hidden sm:block">{e.startTime}–{e.endTime}</p>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* ── Joint Class Drawer ──────────────────────────────────────────────– */}
      <AnimatePresence>
        {drawerGroupId && (
          <>
            <motion.div
              key="drawer-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={closeDrawer}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              key="drawer-panel"
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 340, damping: 30 }}
              className="fixed right-0 top-0 z-50 h-full w-full max-w-sm bg-white shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-violet-50/60">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100">
                    <Users className="h-4 w-4 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">Joint Class</p>
                    {!drawerLoading && (
                      <p className="text-[10px] text-violet-500 font-medium">{drawerEntries.length} department{drawerEntries.length !== 1 ? "s" : ""}</p>
                    )}
                  </div>
                </div>
                <button onClick={closeDrawer} className="rounded-xl p-2 text-gray-400 hover:bg-white hover:text-gray-700 transition">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {drawerLoading ? (
                <div className="flex-1 flex items-center justify-center gap-2 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading details…
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                  {/* Summary card */}
                  <div className="rounded-2xl bg-gradient-to-br from-violet-600 to-violet-700 p-4 text-white">
                    <p className="text-xs font-semibold uppercase tracking-wider text-violet-200 mb-1">Combined Enrollment</p>
                    <p className="text-3xl font-bold">{drawerTotal}</p>
                    {drawerEntries[0] && (
                      <div className="mt-2 pt-2 border-t border-violet-500/40 text-xs text-violet-200 space-y-0.5">
                        <p className="font-semibold text-white">{drawerEntries[0].unitCode} · {drawerEntries[0].unitTitle}</p>
                        <p>{drawerEntries[0].day} · {drawerEntries[0].startTime}–{drawerEntries[0].endTime}</p>
                        <p className="flex items-center gap-1"><MapPin className="h-2.5 w-2.5" />{drawerEntries[0].roomName}</p>
                      </div>
                    )}
                  </div>
                  {/* Per-dept cards */}
                  {drawerEntries.map(me => {
                    const st = STATUS_META[me.status] ?? STATUS_META.Pending;
                    return (
                      <div key={me.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-gray-900">{me.departmentName}</p>
                            <p className="text-xs text-gray-400">{me.courseName}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.pill}`}>{me.status}</span>
                        </div>
                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                          {([
                            [GraduationCap, "Lecturer", me.lecturerName || "—"],
                            [MapPin, "Room", me.roomName || "—"],
                            [Calendar, "Year/Sem", `${me.yearOfStudy ?? "—"} · ${me.semester ?? "—"}`],
                            [Users, "Students", String(me.studentCount)],
                          ] as const).map(([Icon, label, val], j) => (
                            <div key={j} className="contents">
                              <span className="flex items-center gap-1.5 text-gray-400">
                                <Icon className="h-3 w-3" />{label}
                              </span>
                              <span className={`font-medium ${j === 3 ? "text-violet-700 font-bold" : "text-gray-700"}`}>{val}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Modal ─────────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showModal && (
          <>
            <motion.div
              key="modal-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowModal(false)}
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                key="modal"
                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 12 }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
                className="relative w-full max-w-xl pointer-events-auto flex flex-col rounded-2xl bg-white shadow-[0_24px_64px_rgba(0,0,0,0.28)] overflow-hidden max-h-[92vh]"
              >
                {/* ── Gradient header ──────────────────────────────────────── */}
                <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 px-6 pt-5 pb-6 shrink-0">
                  <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/5" />
                  <div className="pointer-events-none absolute -bottom-8 -left-6 h-28 w-28 rounded-full bg-white/5" />
                  <div className="relative flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                        <Calendar className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-white leading-tight">New Timetable Entry</h2>
                        <p className="mt-0.5 text-xs text-indigo-200">
                          {entriesAddedInSession > 0
                            ? `${entriesAddedInSession} entr${entriesAddedInSession === 1 ? "y" : "ies"} added this session`
                            : admin?.departmentName ?? "Department Admin"}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => setShowModal(false)}
                      className="rounded-xl p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  {/* Step progress */}
                  {(() => {
                    const steps = [
                      { label: "Scope",    done: !!(form.courseId && form.yearId && form.semesterId) },
                      { label: "Unit",     done: !!form.unitId },
                      { label: "Lecturer", done: !!form.lecturerId },
                      { label: "Time",     done: !!timeSlotReady },
                      { label: "Room",     done: !!form.roomId },
                    ];
                    return (
                      <div className="relative mt-5 flex items-start">
                        {steps.map((step, i) => (
                          <div key={step.label} className="flex-1 flex flex-col items-center">
                            <div className="relative w-full flex items-center justify-center">
                              {i > 0 && (
                                <div className={`absolute right-1/2 left-0 top-1/2 -translate-y-1/2 h-px transition-colors ${steps[i - 1].done ? "bg-white/60" : "bg-white/20"}`} />
                              )}
                              {i < steps.length - 1 && (
                                <div className={`absolute left-1/2 right-0 top-1/2 -translate-y-1/2 h-px transition-colors ${step.done ? "bg-white/60" : "bg-white/20"}`} />
                              )}
                              <div className={`relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-2 transition-all ${
                                step.done ? "bg-white ring-white text-indigo-700" : "bg-indigo-700/60 ring-white/30 text-white/70"
                              }`}>
                                {step.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                              </div>
                            </div>
                            <span className={`mt-1.5 text-[9px] font-semibold tracking-wide uppercase ${step.done ? "text-white/90" : "text-white/40"}`}>
                              {step.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* ── Scrollable body ───────────────────────────────────────── */}
                <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
                  <AnimatePresence>
                    {lastSuccessMessage && (
                      <motion.div key="success-toast"
                        initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden">
                        <div className="mb-1 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-2.5 text-sm text-emerald-700 font-medium">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                          {lastSuccessMessage}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {modalLoading ? (
                    <div className="space-y-3 py-2">
                      {[80, 48, 48, 96, 80].map((h, i) => (
                        <div key={i} style={{ height: h }} className="rounded-xl bg-gray-100 animate-pulse" />
                      ))}
                    </div>
                  ) : (
                    <form className="space-y-5" onSubmit={e => e.preventDefault()}>

                      {/* Step 1 — Academic Scope */}
                      <section>
                        <SectionHeader num={1} label="Academic Scope" done={!!(form.courseId && form.yearId && form.semesterId)} />
                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className={lbl}>Course <Req /></label>
                            <select required value={form.courseId} onChange={e => handleChange("courseId", e.target.value)} className={inp}>
                              <option value="">Select course…</option>
                              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={lbl}>Year <Req /></label>
                            <select required value={form.yearId} onChange={e => handleChange("yearId", e.target.value)}
                              disabled={!form.courseId || yearsForCourse.length === 0} className={inp}>
                              <option value="">{!form.courseId ? "Course first" : yearsForCourse.length === 0 ? "No years" : "Select year…"}</option>
                              {yearsForCourse.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className={lbl}>Semester <Req /></label>
                            <select required value={form.semesterId} onChange={e => handleChange("semesterId", e.target.value)}
                              disabled={!form.yearId || semestersForYear.length === 0} className={inp}>
                              <option value="">{!form.yearId ? "Year first" : semestersForYear.length === 0 ? "No semesters" : "Select…"}</option>
                              {semestersForYear.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                            </select>
                          </div>
                        </div>
                      </section>

                      {/* Step 2 — Unit */}
                      <section>
                        <SectionHeader num={2} label="Unit" done={!!form.unitId} />
                        <div className="mt-3">
                          <select required value={form.unitId} onChange={e => handleChange("unitId", e.target.value)}
                            disabled={!form.semesterId || filteredUnits.length === 0} className={inp}>
                            <option value="">{!form.semesterId ? "Complete scope first" : filteredUnits.length === 0 ? "No units in this semester" : "Select unit…"}</option>
                            {filteredUnits.map(u => <option key={u.id} value={u.id}>{u.code} – {u.title}</option>)}
                          </select>
                        </div>
                      </section>

                      {/* Step 3 — Lecturer */}
                      <section>
                        <SectionHeader num={3} label="Lecturer" done={!!form.lecturerId} />
                        <div className="mt-3">
                          <select required value={form.lecturerId} onChange={e => handleChange("lecturerId", e.target.value)}
                            disabled={!form.unitId} className={inp}>
                            <option value="">{!form.unitId ? "Select unit first" : "Select lecturer…"}</option>
                            {lecturers.map(l => <option key={l.id} value={l.id}>{l.fullName}</option>)}
                          </select>
                        </div>
                      </section>

                      {/* Step 4 — Time Slot */}
                      <section>
                        <SectionHeader num={4} label="Time Slot" done={!!(form.startTime && form.endTime && form.startTime < form.endTime)} />
                        <div className="mt-3 space-y-3">
                          <div>
                            <label className={lbl}>Day <Req /></label>
                            <div className="flex gap-1.5">
                              {DAYS.map(d => (
                                <button key={d} type="button" disabled={!form.lecturerId}
                                  onClick={() => handleChange("day", d)}
                                  className={`flex-1 rounded-lg py-2 text-[11px] font-bold tracking-wide transition disabled:opacity-30 disabled:cursor-not-allowed ${
                                    form.day === d
                                      ? "bg-indigo-600 text-white shadow-sm shadow-indigo-300"
                                      : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                                  }`}>
                                  {d.slice(0, 3)}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-end gap-3">
                            <div className="flex-1">
                              <label className={lbl}>Start <Req /></label>
                              <input required type="time" value={form.startTime}
                                onChange={e => handleChange("startTime", e.target.value)}
                                disabled={!form.lecturerId} className={inp} />
                            </div>
                            <span className="pb-2.5 text-gray-400 font-medium text-sm select-none">→</span>
                            <div className="flex-1">
                              <label className={lbl}>End <Req /></label>
                              <input required type="time" value={form.endTime}
                                onChange={e => handleChange("endTime", e.target.value)}
                                disabled={!form.lecturerId} className={inp} />
                            </div>
                            {timeSlotReady && form.startTime < form.endTime && (
                              <div className="shrink-0 pb-0.5">
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 border border-indigo-100 px-2.5 py-2 text-xs font-semibold text-indigo-600">
                                  <Clock className="h-3.5 w-3.5" />
                                  {formatDuration(timeToMins(form.endTime) - timeToMins(form.startTime))}
                                </span>
                              </div>
                            )}
                          </div>
                          {form.startTime && form.endTime && form.startTime >= form.endTime && (
                            <p className="flex items-center gap-1.5 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">
                              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> End time must be after start time.
                            </p>
                          )}
                        </div>
                      </section>

                      {/* Step 5 — Venue / Room */}
                      <section>
                        <div className="flex items-center justify-between">
                          <SectionHeader num={5} label="Venue / Room" done={!!form.roomId} />
                          {roomsLoading && (
                            <span className="flex items-center gap-1.5 text-xs text-indigo-500 font-medium">
                              <Loader2 className="h-3 w-3 animate-spin" /> Checking…
                            </span>
                          )}
                          {!roomsLoading && timeSlotReady && availableRooms.length > 0 && (
                            <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                              <CheckCircle2 className="h-3 w-3" />
                              {availableRooms.length} room{availableRooms.length !== 1 ? "s" : ""} free
                            </span>
                          )}
                        </div>
                        <div className="mt-3">
                          {!timeSlotReady ? (
                            <div className="rounded-xl border-2 border-dashed border-gray-200 py-7 text-center">
                              <p className="text-xs font-medium text-gray-400">Complete the time slot to see available rooms</p>
                            </div>
                          ) : roomsLoading ? (
                            <div className="grid grid-cols-2 gap-2">
                              {[1, 2, 3, 4].map(i => <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />)}
                            </div>
                          ) : availableRooms.length === 0 ? (
                            <div className="rounded-xl border-2 border-dashed border-amber-200 bg-amber-50 py-6 text-center">
                              <p className="text-sm font-semibold text-amber-700">No rooms free for this slot</p>
                              <p className="mt-0.5 text-xs text-amber-500">Try a different day or time</p>
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              {availableRooms.map(r => (
                                <button key={r.id} type="button" onClick={() => handleChange("roomId", r.id)}
                                  className={`rounded-xl border-2 p-3 text-left transition-all ${
                                    form.roomId === r.id
                                      ? "border-indigo-500 bg-indigo-50 shadow-sm"
                                      : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-gray-50"
                                  }`}>
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-sm font-bold text-gray-900 truncate">{r.roomCode}</span>
                                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                                      form.roomId === r.id ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"
                                    }`}>cap {r.capacity}</span>
                                  </div>
                                  <p className="mt-0.5 text-xs text-gray-500 truncate">{r.name}</p>
                                  {form.roomId === r.id && (
                                    <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-indigo-600">
                                      <CheckCircle2 className="h-3 w-3" /> Selected
                                    </div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </section>

                      {/* Ready-to-schedule summary */}
                      <AnimatePresence>
                        {form.roomId && !mergeConflict && (
                          <motion.div key="summary"
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                            className="rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 p-4">
                            <div className="flex items-center gap-2 mb-3">
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              <p className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Ready to schedule</p>
                            </div>
                            {(() => {
                              const su = filteredUnits.find(u => u.id === form.unitId) ?? units.find(u => u.id === form.unitId);
                              const sl = lecturers.find(l => l.id === form.lecturerId);
                              return (
                                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                                  <dt className="font-medium text-gray-400">Unit</dt>
                                  <dd className="truncate font-semibold text-gray-800">{su?.code} – {su?.title}</dd>
                                  <dt className="font-medium text-gray-400">Lecturer</dt>
                                  <dd className="truncate font-semibold text-gray-800">{sl?.fullName}</dd>
                                  <dt className="font-medium text-gray-400">When</dt>
                                  <dd className="font-semibold text-gray-800">{form.day} · {form.startTime} – {form.endTime}</dd>
                                  <dt className="font-medium text-gray-400">Venue</dt>
                                  <dd className="truncate font-semibold text-gray-800">{form.venueName}</dd>
                                </dl>
                              );
                            })()}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Joint class merge prompt — actions live in the sticky footer */}
                      {mergeConflict && (
                        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100">
                              <Users className="h-4 w-4 text-amber-600" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-amber-800">Joint Class Opportunity</p>
                              <p className="text-xs text-amber-700 mt-0.5">{mergeConflict.message}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                Confirm below to join this session — students from both departments will share the class.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Error */}
                      {submitError && (
                        <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                          <p className="text-xs text-red-700">{submitError}</p>
                        </div>
                      )}

                    </form>
                  )}
                </div>

                {/* ── Sticky footer ─────────────────────────────────────────── */}
                <div className="shrink-0 border-t border-gray-100 bg-gray-50/80 px-6 py-4 flex gap-3">
                  {mergeConflict ? (
                    <>
                      <button type="button"
                        onClick={() => { setMergeConflict(null); setSubmitError(null); }}
                        className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                        Change Slot
                      </button>
                      <button type="button" onClick={handleMerge} disabled={submitting}
                        className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-200 transition flex items-center justify-center gap-2">
                        {submitting
                          ? <><Loader2 className="h-4 w-4 animate-spin" /> Joining…</>
                          : <><Users className="h-4 w-4" /> Confirm Joint Class</>}
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setShowModal(false)}
                        className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                        Close
                      </button>
                      <button type="button" onClick={(e) => handleSubmit(e as any, "submitAndAdd")}
                        disabled={submitting || !form.roomId}
                        className="flex-1 rounded-xl border-2 border-indigo-600 bg-white py-2.5 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2">
                        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : <><Plus className="h-4 w-4" /> Add & Continue</>}
                      </button>
                      <button type="button" onClick={(e) => handleSubmit(e as any, "submit")}
                        disabled={submitting || !form.roomId}
                        className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-200 transition flex items-center justify-center gap-2">
                        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : <><Plus className="h-4 w-4" /> Create & Close</>}
                      </button>
                    </>
                  )}
                </div>

              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
}

