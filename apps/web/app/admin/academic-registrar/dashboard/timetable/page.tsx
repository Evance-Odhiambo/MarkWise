"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Calendar, Search, Building2, Plus, X } from "lucide-react";
import { useAcademicRegistrar } from "../../context";

interface Entry {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  unitCode?: string;
  unitTitle?: string;
  unitId?: string;
  venueName?: string;
  roomId?: string;
  roomName?: string;
  roomCode?: string;
  status: string;
  lecturerName?: string;
  lecturerId?: string;
  courseName?: string;
  courseId?: string;
  departmentId?: string;
  semester?: string;
  yearOfStudy?: string;
}

interface Department { id: string; name: string }
interface Course { id: string; name: string; code?: string; departmentId: string }
interface Unit { id: string; code: string; title: string; courseId?: string }
interface Lecturer { id: string; fullName: string; email: string }
interface Room { id: string; name: string; roomCode: string; buildingCode: string; capacity: number; type: string }

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const STATUS_STYLES: Record<string, string> = {
  Confirmed: "bg-emerald-500/15 text-emerald-600",
  Pending:   "bg-amber-500/15 text-amber-600",
  Cancelled: "bg-red-500/15 text-red-600",
  Online:    "bg-blue-500/15 text-blue-600",
};

const EMPTY_FORM = {
  departmentId: "",
  courseId: "",
  unitId: "",
  lecturerId: "",
  roomId: "",
  day: "Monday",
  startTime: "08:00",
  endTime: "10:00",
  semester: "",
  yearOfStudy: "",
  venueName: "",
};

export default function FacultyTimetablePage() {
  const admin = useAcademicRegistrar();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDay, setActiveDay] = useState("Monday");
  const [deptFilter, setDeptFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Create-entry modal state
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [courses, setCourses] = useState<Course[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    const [d, depts] = await Promise.all([
      fetch(`/api/timetable?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : []) as any,
      fetch(`/api/departments?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
    ]);
    setEntries(d.entries ?? d.data ?? d ?? []);
    setDepartments(depts.departments ?? depts.data ?? depts ?? []);
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const todayName = DAYS[new Date().getDay() - 1] ?? "Monday";
  useEffect(() => { setActiveDay(todayName); }, [todayName]);

  // Load dropdown options when modal opens
  const openModal = useCallback(async () => {
    if (!admin?.institutionId) return;
    setForm({ ...EMPTY_FORM });
    setSubmitError(null);
    setShowModal(true);
    setModalLoading(true);
    try {
      const [c, u, l, r] = await Promise.all([
        fetch(`/api/courses?institutionId=${admin.institutionId}`, { credentials: "include" }).then(res => res.ok ? res.json() : {}) as any,
        fetch(`/api/units?institutionId=${admin.institutionId}`, { credentials: "include" }).then(res => res.ok ? res.json() : {}) as any,
        fetch(`/api/lecturers?institutionId=${admin.institutionId}`, { credentials: "include" }).then(res => res.ok ? res.json() : {}) as any,
        fetch(`/api/rooms?institutionId=${admin.institutionId}`, { credentials: "include" }).then(res => res.ok ? res.json() : []) as any,
      ]);
      setCourses(c.courses ?? c.data ?? c ?? []);
      setUnits(u.units ?? u.data ?? u ?? []);
      setLecturers(l.lecturers ?? l.data ?? l ?? []);
      setRooms(Array.isArray(r) ? r : r.rooms ?? r.data ?? []);
    } finally {
      setModalLoading(false);
    }
  }, [admin?.institutionId]);

  const handleFormChange = (field: string, value: string) => {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      // Auto-fill venueName from the selected room
      if (field === "roomId" && value && !prev.venueName) {
        const room = rooms.find(r => r.id === value);
        if (room) next.venueName = `${room.roomCode} – ${room.name}`;
      }
      // Auto-fill departmentId from the selected course
      if (field === "courseId" && value) {
        const course = courses.find(co => co.id === value);
        if (course?.departmentId) next.departmentId = course.departmentId;
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.departmentId || !form.courseId || !form.unitId || !form.lecturerId || !form.roomId || !form.venueName) {
      setSubmitError("Please fill in all required fields.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const unit = units.find(u => u.id === form.unitId);
      const body = {
        courseId: form.courseId,
        departmentId: form.departmentId,
        unitId: form.unitId,
        lecturerId: form.lecturerId,
        roomId: form.roomId,
        day: form.day,
        startTime: form.startTime,
        endTime: form.endTime,
        venueName: form.venueName,
        semester: form.semester || null,
        yearOfStudy: form.yearOfStudy || null,
        unitCode: unit?.code ?? "",
      };
      const res = await fetch("/api/timetable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (res.status === 409) {
        const data = await res.json();
        setSubmitError(data.message ?? data.error ?? "Time slot conflict detected.");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError(data.error ?? `Error ${res.status}`);
        return;
      }
      setShowModal(false);
      fetchAll();
    } catch (err: any) {
      setSubmitError(err?.message ?? "Failed to create entry.");
    } finally {
      setSubmitting(false);
    }
  };

  const shown = entries
    .filter(e => e.day === activeDay)
    .filter(e => deptFilter === "all" || e.departmentId === deptFilter)
    .filter(e => !search ||
      (e.unitCode ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (e.unitTitle ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (e.lecturerName ?? "").toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const dayCount = (d: string) => entries.filter(e => e.day === d).length;

  // Filtered dropdown options
  const filteredCourses = form.departmentId
    ? courses.filter(c => c.departmentId === form.departmentId)
    : courses;
  const filteredUnits = form.courseId
    ? units.filter(u => (u as any).courseId === form.courseId)
    : units;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Timetable</h1>
          <p className="text-sm text-gray-400 mt-0.5">Institution-wide schedule</p>
        </div>
        <button
          onClick={openModal}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          <Plus className="h-4 w-4" bg-indigo-500 round-lg text-black /> New Entry
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search unit or lecturer…"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 pl-9 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
        </div>
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
          <option value="all">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {/* Day tabs */}
      <div className="flex flex-wrap gap-2">
        {DAYS.map(d => (
          <button key={d} onClick={() => setActiveDay(d)}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-medium transition-colors ${activeDay === d ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
            {d.slice(0,3)} <span className="text-[10px] opacity-70 ml-1">{dayCount(d)}</span>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="hidden sm:grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-3 px-4 py-3 border-b border-gray-200 text-xs font-medium text-gray-400 uppercase tracking-wider">
          <span>Time</span><span>Unit</span><span>Lecturer</span><span>Department</span><span>Status</span>
        </div>
        {loading ? (
          <div className="p-4 space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-14 rounded-xl bg-gray-200 animate-pulse" />)}</div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12"><Calendar className="h-8 w-8 text-slate-700" /><p className="text-sm text-gray-500">No sessions for {activeDay}</p></div>
        ) : shown.map((e, i) => (
          <motion.div key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
            className="grid grid-cols-1 sm:grid-cols-[auto_1fr_1fr_1fr_auto] gap-2 items-center px-4 py-3.5 border-b border-gray-200/60 last:border-b-0">
            <div className="text-xs font-mono text-gray-500 whitespace-nowrap">{e.startTime}–{e.endTime}</div>
            <div>
              <div className="text-sm font-medium text-gray-900">{e.unitCode ?? "—"}</div>
              <div className="text-xs text-gray-400 truncate">{e.unitTitle ?? e.courseName ?? ""}</div>
            </div>
            <div className="text-sm text-gray-500 truncate hidden sm:block">{e.lecturerName ?? "—"}</div>
            <div className="hidden sm:block text-xs text-gray-400 truncate">
              <Building2 className="h-3 w-3 inline mr-1" />
              {departments.find(d => d.id === e.departmentId)?.name ?? "—"}
            </div>
            <div className="hidden sm:block">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[e.status] ?? "bg-slate-100 text-gray-500"}`}>
                {e.status}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Create Entry Modal ───────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-800">New Timetable Entry</h2>
              <button onClick={() => setShowModal(false)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            {modalLoading ? (
              <div className="space-y-3">
                {[1,2,3,4,5].map(i => <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />)}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Department <span className="text-red-500">*</span></label>
                    <select required value={form.departmentId} onChange={e => handleFormChange("departmentId", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
                      <option value="">Select department</option>
                      {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Course <span className="text-red-500">*</span></label>
                    <select required value={form.courseId} onChange={e => handleFormChange("courseId", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
                      <option value="">Select course</option>
                      {filteredCourses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Unit <span className="text-red-500">*</span></label>
                    <select required value={form.unitId} onChange={e => handleFormChange("unitId", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
                      <option value="">Select unit</option>
                      {filteredUnits.map(u => <option key={u.id} value={u.id}>{u.code} – {u.title}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Lecturer <span className="text-red-500">*</span></label>
                    <select required value={form.lecturerId} onChange={e => handleFormChange("lecturerId", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
                      <option value="">Select lecturer</option>
                      {lecturers.map(l => <option key={l.id} value={l.id}>{l.fullName}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Room <span className="text-red-500">*</span></label>
                    <select required value={form.roomId} onChange={e => handleFormChange("roomId", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
                      <option value="">Select room</option>
                      {rooms.map(r => (
                        <option key={r.id} value={r.id}>
                          {r.roomCode} – {r.name} (cap: {r.capacity})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Venue Name <span className="text-red-500">*</span></label>
                    <input required value={form.venueName} onChange={e => handleFormChange("venueName", e.target.value)}
                      placeholder="e.g. Room 101, Lab A"
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Day <span className="text-red-500">*</span></label>
                    <select required value={form.day} onChange={e => handleFormChange("day", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
                      {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Semester</label>
                    <select value={form.semester} onChange={e => handleFormChange("semester", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50">
                      <option value="">Select semester</option>
                      <option value="1">Semester 1</option>
                      <option value="2">Semester 2</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Start Time <span className="text-red-500">*</span></label>
                    <input required type="time" value={form.startTime} onChange={e => handleFormChange("startTime", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">End Time <span className="text-red-500">*</span></label>
                    <input required type="time" value={form.endTime} onChange={e => handleFormChange("endTime", e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-gray-600 mb-1 block">Year of Study</label>
                    <input value={form.yearOfStudy} onChange={e => handleFormChange("yearOfStudy", e.target.value)}
                      placeholder="e.g. Year 1"
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
                  </div>

                </div>

                {submitError && (
                  <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                    {submitError}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting}
                    className="flex-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    {submitting ? "Creating…" : "Create Entry"}
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
