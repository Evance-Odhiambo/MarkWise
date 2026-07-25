"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, CheckCircle2, AlertCircle, Loader2, Clock,
  Users, BookOpen, MapPin, GraduationCap, Calendar,
  Plus, Zap, Building2, ChevronRight, Trash2,
} from "lucide-react";
import { useDepartmentAdmin } from "../../../context";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CourseUnit { id: string; code: string; title: string }
interface CourseSem  { id: string; label: string; units: CourseUnit[] }
interface CourseYear { id: string; name: string; semesters: CourseSem[] }
interface Course     { id: string; name: string; departmentId: string; years: CourseYear[] }
interface Unit       { id: string; code: string; title: string }
interface Lecturer   { id: string; fullName: string }
interface Room       { id: string; name: string; roomCode: string; capacity: number; status?: string }

interface SessionEntry {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  unitCode: string;
  unitTitle: string;
  lecturerName: string;
  roomCode: string;
  courseName: string;
}

interface SlimEntry {
  id: string;
  lecturerId: string;
  unitId: string;
  day: string;
  startTime: string;
  endTime: string;
  status: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DAY_COLORS: Record<string, { bg: string; text: string; light: string; border: string }> = {
  Monday:    { bg: "bg-indigo-500",  text: "text-indigo-600",  light: "bg-indigo-50",  border: "border-indigo-200" },
  Tuesday:   { bg: "bg-violet-500",  text: "text-violet-600",  light: "bg-violet-50",  border: "border-violet-200" },
  Wednesday: { bg: "bg-cyan-500",    text: "text-cyan-600",    light: "bg-cyan-50",    border: "border-cyan-200"   },
  Thursday:  { bg: "bg-teal-500",    text: "text-teal-600",    light: "bg-teal-50",    border: "border-teal-200"   },
  Friday:    { bg: "bg-orange-500",  text: "text-orange-600",  light: "bg-orange-50",  border: "border-orange-200" },
  Saturday:  { bg: "bg-pink-500",    text: "text-pink-600",    light: "bg-pink-50",    border: "border-pink-200"   },
};

const EMPTY_FORM = {
  courseId: "", yearId: "", semesterId: "", unitId: "",
  lecturerId: "", roomId: "", venueName: "",
  day: "Monday", startTime: "08:00", endTime: "10:00",
};

const inp = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400 transition disabled:opacity-40 disabled:cursor-not-allowed";
const lbl = "block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide";

// ─── Utilities ────────────────────────────────────────────────────────────────

function timeToMins(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

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
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead));
  const startAt = new Date(base); startAt.setUTCHours(sh, sm, 0, 0);
  const endAt   = new Date(base); endAt.setUTCHours(eh, em, 0, 0);
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepBadge({ num, done, active }: { num: number; done: boolean; active: boolean }) {
  return (
    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${
      done
        ? "bg-emerald-100 text-emerald-600"
        : active
        ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200"
        : "bg-gray-100 text-gray-400"
    }`}>
      {done ? <CheckCircle2 className="h-4 w-4" /> : num}
    </div>
  );
}

function StepCard({
  num, title, done, active, children,
}: {
  num: number; title: string; done: boolean; active: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border transition-all ${
      active
        ? "border-indigo-200 bg-white shadow-sm shadow-indigo-50"
        : done
        ? "border-emerald-100 bg-emerald-50/30"
        : "border-gray-100 bg-gray-50/60"
    }`}>
      <div className="flex items-center gap-3 px-5 py-4">
        <StepBadge num={num} done={done} active={active} />
        <p className={`text-sm font-bold uppercase tracking-wider ${
          done ? "text-emerald-600" : active ? "text-indigo-700" : "text-gray-400"
        }`}>
          {title}
        </p>
      </div>
      {(active || done) && (
        <div className="px-5 pb-5">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Week Preview ─────────────────────────────────────────────────────────────

function WeekPreview({
  day, startTime, endTime, unitCode, roomCode,
}: {
  day: string; startTime: string; endTime: string;
  unitCode: string; roomCode: string;
}) {
  const GRID_START = 7 * 60;  // 07:00
  const GRID_END   = 21 * 60; // 21:00
  const GRID_SPAN  = GRID_END - GRID_START;

  const startMins = timeToMins(startTime);
  const endMins   = timeToMins(endTime);
  const valid = startMins >= GRID_START && endMins <= GRID_END && startMins < endMins;

  const topPct    = valid ? ((startMins - GRID_START) / GRID_SPAN) * 100 : 0;
  const heightPct = valid ? ((endMins - startMins) / GRID_SPAN) * 100 : 0;

  const col = DAY_COLORS[day] ?? DAY_COLORS.Monday;

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {DAYS.map(d => (
          <div key={d}
            className={`flex-1 rounded-t-md py-1 text-center text-[9px] font-bold uppercase tracking-wide transition-all ${
              d === day ? `${col.bg} text-white` : "bg-gray-100 text-gray-400"
            }`}>
            {d.slice(0, 2)}
          </div>
        ))}
      </div>
      <div className="relative h-40 rounded-b-xl border border-gray-100 bg-gray-50 overflow-hidden">
        {/* Hour lines */}
        {[8, 10, 12, 14, 16, 18, 20].map(h => (
          <div key={h}
            className="absolute left-0 right-0 border-t border-gray-200/60"
            style={{ top: `${((h * 60 - GRID_START) / GRID_SPAN) * 100}%` }}
          >
            <span className="absolute -top-2 left-1 text-[8px] text-gray-300">{h}:00</span>
          </div>
        ))}
        {/* Entry block */}
        {valid && (
          <div
            className={`absolute rounded-md ${col.bg} opacity-90 flex items-center justify-center px-1 overflow-hidden`}
            style={{
              top:    `${topPct}%`,
              height: `${heightPct}%`,
              left:   `${(DAYS.indexOf(day) / DAYS.length) * 100}%`,
              width:  `${(1 / DAYS.length) * 100}%`,
            }}
          >
            <p className="text-[8px] font-bold text-white truncate rotate-0 leading-tight text-center">
              {unitCode || "Unit"}
            </p>
          </div>
        )}
        {!valid && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs text-gray-300 font-medium">Complete form to preview</p>
          </div>
        )}
      </div>
      {valid && (
        <div className={`flex items-center gap-2 rounded-xl ${col.light} ${col.border} border px-3 py-2`}>
          <div className={`h-2 w-2 rounded-full ${col.bg}`} />
          <span className={`text-xs font-semibold ${col.text}`}>
            {day} · {startTime} – {endTime}
          </span>
          {roomCode && (
            <span className="ml-auto text-xs text-gray-500 font-medium">{roomCode}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NewTimetableEntryPage() {
  const admin  = useDepartmentAdmin();
  const router = useRouter();

  // Form state
  const [form, setForm]                     = useState({ ...EMPTY_FORM });
  const [courses, setCourses]               = useState<Course[]>([]);
  const [units, setUnits]                   = useState<Unit[]>([]);
  const [lecturers, setLecturers]           = useState<Lecturer[]>([]);
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [existingEntries, setExistingEntries] = useState<SlimEntry[]>([]);
  const [dataLoading, setDataLoading]       = useState(true);
  const [roomsLoading, setRoomsLoading]     = useState(false);
  const [submitting, setSubmitting]         = useState(false);
  const [submitError, setSubmitError]       = useState<string | null>(null);
  const [mergeConflict, setMergeConflict]   = useState<{ conflictId: string; message: string } | null>(null);
  const [lastSuccess, setLastSuccess]       = useState<string | null>(null);

  // Session history — entries added on this page visit
  const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([]);

  const roomFetchTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch reference data + existing timetable on mount (all parallel)
  useEffect(() => {
    if (!admin?.departmentId) return;
    setDataLoading(true);
    Promise.all([
      fetch(`/api/courses?departmentId=${admin.departmentId}`,   { credentials: "include" }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`/api/units?departmentId=${admin.departmentId}`,     { credentials: "include" }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      fetch(`/api/lecturers?departmentId=${admin.departmentId}`, { credentials: "include" }).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/timetable?departmentId=${admin.departmentId}`, { credentials: "include" }).then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([c, u, l, t]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCourses(Array.isArray(c) ? c : ((c as any).courses ?? (c as any).data ?? []));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setUnits(Array.isArray(u) ? u : ((u as any).units ?? (u as any).data ?? []));
      setLecturers(Array.isArray(l) ? l : ((l as any).lecturers ?? (l as any).data ?? []));
      const raw: any[] = Array.isArray(t) ? t : ((t as any).data ?? []);
      setExistingEntries(
        raw
          .filter((e: any) => e.status !== "Cancelled")
          .map((e: any) => ({
            id: e.id, lecturerId: e.lecturerId, unitId: e.unitId,
            day: e.day, startTime: e.startTime, endTime: e.endTime, status: e.status,
          }))
      );
    }).finally(() => setDataLoading(false));
  }, [admin?.departmentId]);

  // Cleanup debounce on unmount
  useEffect(() => () => { if (roomFetchTimerRef.current) clearTimeout(roomFetchTimerRef.current); }, []);

  // Debounced room fetch
  const fetchAvailableRooms = useCallback((day: string, startTime: string, endTime: string) => {
    if (!admin?.institutionId || startTime >= endTime) return;
    if (roomFetchTimerRef.current) clearTimeout(roomFetchTimerRef.current);
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
        setAvailableRooms(
          raw
            .filter(r => !r.status || r.status === "free" || r.status === "available")
            .map(r => ({
              id: r.id, name: r.name,
              roomCode: r.roomCode ?? r.room_code ?? "",
              capacity: r.capacity ?? 0, status: r.status,
            }))
        );
      } catch { /* silent */ } finally {
        setRoomsLoading(false);
      }
    }, 400);
  }, [admin?.institutionId]);

  // Re-fetch rooms when time/day changes
  useEffect(() => {
    if (form.day && form.startTime && form.endTime && form.startTime < form.endTime) {
      fetchAvailableRooms(form.day, form.startTime, form.endTime);
    }
  }, [form.day, form.startTime, form.endTime, fetchAvailableRooms]);

  // Derived lists
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
    return semUnits.length > 0 ? semUnits : units;
  }, [semestersForYear, form.semesterId, units]);

  const selectedUnit     = useMemo(() => filteredUnits.find(u => u.id === form.unitId) ?? units.find(u => u.id === form.unitId), [filteredUnits, units, form.unitId]);
  const selectedLecturer = useMemo(() => lecturers.find(l => l.id === form.lecturerId), [lecturers, form.lecturerId]);
  const selectedRoom     = useMemo(() => availableRooms.find(r => r.id === form.roomId), [availableRooms, form.roomId]);
  const selectedCourse   = useMemo(() => courses.find(c => c.id === form.courseId), [courses, form.courseId]);
  const timeSlotReady    = !!(form.day && form.startTime && form.endTime && form.startTime < form.endTime);
  const durationMins     = timeSlotReady ? timeToMins(form.endTime) - timeToMins(form.startTime) : 0;

  // Real-time conflict checks against already-loaded department entries
  const lecturerConflict = useMemo(() => {
    if (!form.lecturerId || !timeSlotReady) return null;
    return existingEntries.find(e =>
      e.lecturerId === form.lecturerId &&
      e.day === form.day &&
      timeToMins(e.startTime) < timeToMins(form.endTime) &&
      timeToMins(e.endTime)   > timeToMins(form.startTime)
    ) ?? null;
  }, [existingEntries, form.lecturerId, form.day, form.startTime, form.endTime, timeSlotReady]);

  const unitConflict = useMemo(() => {
    if (!form.unitId || !timeSlotReady) return null;
    return existingEntries.find(e =>
      e.unitId === form.unitId &&
      e.day === form.day &&
      timeToMins(e.startTime) < timeToMins(form.endTime) &&
      timeToMins(e.endTime)   > timeToMins(form.startTime)
    ) ?? null;
  }, [existingEntries, form.unitId, form.day, form.startTime, form.endTime, timeSlotReady]);

  // Step completion state
  const step1Done = !!(form.courseId && form.yearId && form.semesterId);
  const step2Done = !!form.unitId;
  const step3Done = !!form.lecturerId;
  const step4Done = timeSlotReady;
  const step5Done = !!form.roomId;

  const activeStep = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : !step4Done ? 4 : 5;

  const handleChange = useCallback((field: string, value: string) => {
    setMergeConflict(null);
    setSubmitError(null);
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (field === "courseId") { next.yearId = ""; next.semesterId = ""; next.unitId = ""; }
      else if (field === "yearId")     { next.semesterId = ""; next.unitId = ""; }
      else if (field === "semesterId") { next.unitId = ""; }
      if (field === "day" || field === "startTime" || field === "endTime") {
        next.roomId = ""; next.venueName = "";
      }
      if (field === "roomId" && value) {
        const room = availableRooms.find(r => r.id === value);
        if (room) next.venueName = `${room.roomCode} – ${room.name}`;
      }
      return next;
    });
  }, [availableRooms]);

  const resetForAnother = useCallback(() => {
    setForm(prev => ({ ...prev, unitId: "", roomId: "", venueName: "" }));
    setSubmitError(null);
    setMergeConflict(null);
    setAvailableRooms([]);
    setLastSuccess(null);
  }, []);

  const handleSubmit = async (mode: "done" | "another") => {
    if (!form.courseId || !form.yearId || !form.semesterId || !form.unitId ||
        !form.lecturerId || !form.roomId) {
      setSubmitError("Please complete all steps."); return;
    }
    if (form.startTime >= form.endTime) {
      setSubmitError("End time must be after start time."); return;
    }
    setSubmitting(true); setSubmitError(null);
    try {
      const year      = yearsForCourse.find(y => y.id === form.yearId);
      const semObj    = year?.semesters.find(s => s.id === form.semesterId);
      const yearOfStudy = year?.name ?? "";
      const semester    = semObj?.label ?? "";

      const res = await fetch("/api/timetable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          courseId: form.courseId, departmentId: admin!.departmentId,
          institutionId: admin!.institutionId,
          unitId: form.unitId, lecturerId: form.lecturerId,
          roomId: form.roomId, day: form.day,
          startTime: form.startTime, endTime: form.endTime,
          venueName: form.venueName,
          semester: semester || null, yearOfStudy: yearOfStudy || null,
          unitCode: selectedUnit?.code ?? "",
        }),
      });

      if (res.status === 409) {
        const d = await res.json();
        if (d.mergePrompt && d.conflictId) {
          setMergeConflict({ conflictId: d.conflictId, message: d.message ?? "This slot is already scheduled." });
          return;
        }
        setSubmitError(d.message ?? d.error ?? "Conflict detected — please review the slot.");
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSubmitError(d.error ?? `Error ${res.status}`); return;
      }

      const created = await res.json();
      setSessionEntries(prev => [{
        id:           created.id,
        day:          created.day,
        startTime:    created.startTime,
        endTime:      created.endTime,
        unitCode:     selectedUnit?.code ?? "",
        unitTitle:    selectedUnit?.title ?? "",
        lecturerName: selectedLecturer?.fullName ?? "",
        roomCode:     selectedRoom?.roomCode ?? "",
        courseName:   selectedCourse?.name ?? "",
      }, ...prev]);

      if (mode === "another") {
        setLastSuccess(`✓ ${selectedUnit?.code ?? "Entry"} · ${form.day} ${form.startTime}–${form.endTime} added`);
        resetForAnother();
      } else {
        router.push("/admin/department-admin/dashboard/timetable");
      }
    } catch (err: any) {
      setSubmitError(err?.message ?? "Failed to create entry.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMerge = async () => {
    if (!mergeConflict || !admin) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const year   = yearsForCourse.find(y => y.id === form.yearId);
      const semObj = year?.semesters.find(s => s.id === form.semesterId);
      const res = await fetch(`/api/timetable/${mergeConflict.conflictId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          departmentId: admin.departmentId,
          courseId:     form.courseId,
          lecturerId:   form.lecturerId || undefined,
          yearOfStudy:  year?.name || undefined,
          semester:     semObj?.label || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSubmitError(d.error ?? `Merge failed (${res.status})`);
        setMergeConflict(null); return;
      }
      setMergeConflict(null);
      setSessionEntries(prev => [{
        id:           crypto.randomUUID(),
        day:          form.day,
        startTime:    form.startTime,
        endTime:      form.endTime,
        unitCode:     selectedUnit?.code ?? "",
        unitTitle:    selectedUnit?.title ?? "",
        lecturerName: selectedLecturer?.fullName ?? "",
        roomCode:     selectedRoom?.roomCode ?? "(Joint)",
        courseName:   selectedCourse?.name ?? "",
      }, ...prev]);
      setLastSuccess(`✓ Joint class created for ${selectedUnit?.code ?? "entry"}`);
      resetForAnother();
    } catch (err: any) {
      setSubmitError(err?.message ?? "Merge failed.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-[1200px]">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/department-admin/dashboard/timetable"
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Timetable
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
          <h1 className="text-lg font-bold text-gray-900">New Entry</h1>
        </div>
        {sessionEntries.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" />
            {sessionEntries.length} added this session
          </span>
        )}
      </div>

      {/* ── Two-column layout ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">

        {/* ── LEFT: Form ──────────────────────────────────────────────── */}
        <div className="space-y-3">

          {/* Success toast */}
          <AnimatePresence>
            {lastSuccess && (
              <motion.div key="toast"
                initial={{ opacity: 0, y: -8, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  {lastSuccess}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {dataLoading ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {/* Step 1 — Academic Scope */}
              <StepCard num={1} title="Academic Scope" done={step1Done} active={activeStep === 1 || step1Done}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={lbl}>Course <span className="text-red-400">*</span></label>
                    <select value={form.courseId} onChange={e => handleChange("courseId", e.target.value)} className={inp}>
                      <option value="">Select course…</option>
                      {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Year <span className="text-red-400">*</span></label>
                    <select value={form.yearId} onChange={e => handleChange("yearId", e.target.value)}
                      disabled={!form.courseId} className={inp}>
                      <option value="">{!form.courseId ? "Course first" : "Select year…"}</option>
                      {yearsForCourse.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Semester <span className="text-red-400">*</span></label>
                    <select value={form.semesterId} onChange={e => handleChange("semesterId", e.target.value)}
                      disabled={!form.yearId} className={inp}>
                      <option value="">{!form.yearId ? "Year first" : "Select semester…"}</option>
                      {semestersForYear.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
              </StepCard>

              {/* Step 2 — Unit */}
              <StepCard num={2} title="Unit" done={step2Done} active={step1Done}>
                <select value={form.unitId} onChange={e => handleChange("unitId", e.target.value)}
                  disabled={!form.semesterId || filteredUnits.length === 0} className={inp}>
                  <option value="">
                    {!form.semesterId ? "Complete scope first" : filteredUnits.length === 0 ? "No units in this semester" : "Select unit…"}
                  </option>
                  {filteredUnits.map(u => <option key={u.id} value={u.id}>{u.code} — {u.title}</option>)}
                </select>
              </StepCard>

              {/* Step 3 — Lecturer */}
              <StepCard num={3} title="Lecturer" done={step3Done} active={step2Done}>
                <select value={form.lecturerId} onChange={e => handleChange("lecturerId", e.target.value)}
                  disabled={!form.unitId} className={inp}>
                  <option value="">{!form.unitId ? "Select unit first" : "Select lecturer…"}</option>
                  {lecturers.map(l => <option key={l.id} value={l.id}>{l.fullName}</option>)}
                </select>
                {lecturerConflict && (
                  <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-medium text-amber-700">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    This lecturer already has a class on {lecturerConflict.day} {lecturerConflict.startTime}–{lecturerConflict.endTime}. You&apos;ll be offered a joint class at save time.
                  </p>
                )}
              </StepCard>

              {/* Step 4 — Time Slot */}
              <StepCard num={4} title="Time Slot" done={step4Done} active={step3Done}>
                <div className="space-y-4">
                  <div>
                    <label className={lbl}>Day <span className="text-red-400">*</span></label>
                    <div className="flex gap-1.5">
                      {DAYS.map(d => (
                        <button key={d} type="button"
                          disabled={!form.lecturerId}
                          onClick={() => handleChange("day", d)}
                          className={`flex-1 rounded-xl py-2.5 text-[11px] font-bold tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                            form.day === d
                              ? "bg-indigo-600 text-white shadow-sm shadow-indigo-300"
                              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                          }`}>
                          {d.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className={lbl}>Start <span className="text-red-400">*</span></label>
                      <input type="time" value={form.startTime}
                        onChange={e => handleChange("startTime", e.target.value)}
                        disabled={!form.lecturerId} className={inp} />
                    </div>
                    <span className="pb-2.5 text-gray-300 font-bold text-lg select-none">→</span>
                    <div className="flex-1">
                      <label className={lbl}>End <span className="text-red-400">*</span></label>
                      <input type="time" value={form.endTime}
                        onChange={e => handleChange("endTime", e.target.value)}
                        disabled={!form.lecturerId} className={inp} />
                    </div>
                    {timeSlotReady && (
                      <div className="shrink-0 pb-0.5">
                        <span className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2.5 text-sm font-bold text-indigo-600">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDuration(durationMins)}
                        </span>
                      </div>
                    )}
                  </div>
                  {form.startTime && form.endTime && form.startTime >= form.endTime && (
                    <p className="flex items-center gap-1.5 rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-xs text-red-600">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" /> End time must be after start time.
                    </p>
                  )}
                  {unitConflict && (
                    <p className="flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs font-medium text-amber-700">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      This unit already has a session on {unitConflict.day} {unitConflict.startTime}–{unitConflict.endTime}. A joint class merge will be offered on save.
                    </p>
                  )}
                </div>
              </StepCard>

              {/* Step 5 — Venue / Room */}
              <StepCard num={5} title="Venue / Room" done={step5Done} active={step4Done}>
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-500">
                      {!timeSlotReady ? "Complete time slot first" : "Rooms available for this slot:"}
                    </p>
                    {roomsLoading && (
                      <span className="flex items-center gap-1.5 text-xs text-indigo-500 font-medium">
                        <Loader2 className="h-3 w-3 animate-spin" /> Checking rooms…
                      </span>
                    )}
                    {!roomsLoading && timeSlotReady && availableRooms.length > 0 && (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                        <CheckCircle2 className="h-3 w-3" />
                        {availableRooms.length} free
                      </span>
                    )}
                  </div>

                  {!timeSlotReady ? (
                    <div className="rounded-xl border-2 border-dashed border-gray-200 py-8 text-center">
                      <MapPin className="h-6 w-6 text-gray-300 mx-auto mb-2" />
                      <p className="text-xs text-gray-400">Set the time slot to see available rooms</p>
                    </div>
                  ) : roomsLoading ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {[1,2,3,4,5,6].map(i => <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />)}
                    </div>
                  ) : availableRooms.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-amber-200 bg-amber-50 py-7 text-center">
                      <p className="text-sm font-semibold text-amber-700">No rooms free for this slot</p>
                      <p className="mt-1 text-xs text-amber-500">Try a different day or time window</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {availableRooms.map(r => (
                        <button key={r.id} type="button"
                          onClick={() => handleChange("roomId", r.id)}
                          className={`rounded-xl border-2 p-3.5 text-left transition-all ${
                            form.roomId === r.id
                              ? "border-indigo-500 bg-indigo-50 shadow-sm"
                              : "border-gray-200 bg-white hover:border-indigo-200 hover:bg-gray-50"
                          }`}>
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-sm font-bold text-gray-900 truncate">{r.roomCode}</span>
                            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                              form.roomId === r.id ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-500"
                            }`}>
                              {r.capacity}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 truncate">{r.name}</p>
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
              </StepCard>

              {/* Merge conflict prompt */}
              <AnimatePresence>
                {mergeConflict && (
                  <motion.div key="merge"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
                    className="rounded-2xl bg-amber-50 border border-amber-200 p-5">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100">
                        <Users className="h-4.5 w-4.5 text-amber-600" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-amber-800">Joint Class Opportunity</p>
                        <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{mergeConflict.message}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Students from both departments will share this session.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button"
                        onClick={() => { setMergeConflict(null); setSubmitError(null); }}
                        className="flex-1 rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                        Change Slot
                      </button>
                      <button type="button" onClick={handleMerge} disabled={submitting}
                        className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50 shadow-lg shadow-amber-200 transition flex items-center justify-center gap-2">
                        {submitting
                          ? <><Loader2 className="h-4 w-4 animate-spin" /> Joining…</>
                          : <><Users className="h-4 w-4" /> Confirm Joint Class</>}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Error */}
              <AnimatePresence>
                {submitError && (
                  <motion.div key="error"
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                      <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-red-700">{submitError}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Action bar */}
              {!mergeConflict && (
                <div className="flex gap-3 pt-1">
                  <Link href="/admin/department-admin/dashboard/timetable"
                    className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                    Cancel
                  </Link>
                  <button type="button"
                    onClick={() => handleSubmit("another")}
                    disabled={submitting || !step5Done}
                    className="flex-1 rounded-xl border-2 border-indigo-600 bg-white py-2.5 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center gap-2">
                    {submitting
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                      : <><Zap className="h-4 w-4" /> Save & Add Another</>}
                  </button>
                  <button type="button"
                    onClick={() => handleSubmit("done")}
                    disabled={submitting || !step5Done}
                    className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-200 transition flex items-center justify-center gap-2">
                    {submitting
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                      : <><CheckCircle2 className="h-4 w-4" /> Save & Done</>}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── RIGHT: Sidebar ───────────────────────────────────────────── */}
        <div className="space-y-4 lg:sticky lg:top-20">

          {/* Schedule preview */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Schedule Preview</p>
            <WeekPreview
              day={form.day}
              startTime={form.startTime}
              endTime={form.endTime}
              unitCode={selectedUnit?.code ?? ""}
              roomCode={selectedRoom?.roomCode ?? ""}
            />
            {step5Done && (
              <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                {[
                  { icon: BookOpen,     label: selectedUnit?.code ?? "—",        sub: selectedUnit?.title },
                  { icon: GraduationCap, label: selectedLecturer?.fullName ?? "—", sub: undefined },
                  { icon: MapPin,       label: selectedRoom?.roomCode ?? "—",    sub: `${selectedRoom?.name ?? ""} · cap ${selectedRoom?.capacity ?? "—"}` },
                  { icon: Building2,    label: selectedCourse?.name ?? "—",      sub: undefined },
                ].map(({ icon: Icon, label, sub }) => (
                  <div key={label} className="flex items-start gap-2.5">
                    <Icon className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-800 truncate">{label}</p>
                      {sub && <p className="text-[10px] text-gray-400 truncate">{sub}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Session history */}
          {sessionEntries.length > 0 && (
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Added This Session</p>
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
                  {sessionEntries.length}
                </span>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {sessionEntries.map(e => {
                  const col = DAY_COLORS[e.day] ?? DAY_COLORS.Monday;
                  return (
                    <div key={e.id} className={`flex items-center gap-2.5 rounded-xl ${col.light} ${col.border} border px-3 py-2.5`}>
                      <div className={`h-2 w-2 shrink-0 rounded-full ${col.bg}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-bold truncate ${col.text}`}>
                          {e.unitCode} · {e.day}
                        </p>
                        <p className="text-[10px] text-gray-500 truncate">
                          {e.startTime}–{e.endTime} · {e.roomCode || "Room"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick tips */}
          {sessionEntries.length === 0 && !step1Done && (
            <div className="rounded-2xl border border-gray-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-5">
              <p className="text-xs font-bold text-indigo-800 uppercase tracking-wider mb-3">Quick Tips</p>
              <ul className="space-y-2">
                {[
                  "Start with the course and semester — units filter automatically.",
                  "Rooms are checked for conflicts the moment you set the time slot.",
                  "Use Save & Add Another to batch-create without leaving this page.",
                  "If a slot conflicts, you'll be offered a joint class merge.",
                ].map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-indigo-700">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[9px] font-bold text-indigo-600">
                      {i + 1}
                    </span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
