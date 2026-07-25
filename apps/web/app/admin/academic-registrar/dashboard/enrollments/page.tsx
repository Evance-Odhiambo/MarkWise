"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ClipboardList, Search, Plus, X, AlertTriangle, Trash2,
  BookOpen, ChevronDown, ChevronUp,
} from "lucide-react";
import { useAcademicRegistrar } from "../../context";

const inp = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500";
const lbl = "block text-xs font-medium text-gray-500 mb-1.5";

interface Student {
  id: string; name: string; admissionNumber: string;
  departmentId: string; course?: { name: string }; department?: { name: string };
}
interface Unit {
  id: string; code: string; title: string; departmentId: string; department?: { name: string };
}
interface Enrollment {
  id: string; unitId: string; unit?: { code: string; title: string; departmentId: string; department?: { name: string } };
}

function AddEnrollmentModal({ student, allUnits, existing, onClose, onSaved }: {
  student: Student; allUnits: Unit[]; existing: Enrollment[];
  onClose: () => void; onSaved: () => void;
}) {
  const [unitId, setUnitId] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const enrolledIds = new Set(existing.map(e => e.unitId));
  const available = allUnits.filter(u => !enrolledIds.has(u.id));

  const save = async () => {
    if (!unitId) { setErr("Select a unit"); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/enrollments", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id, unitId }),
      });
      if (!r.ok) { const j = await r.json(); setErr(j.error ?? "Failed"); setSaving(false); return; }
      onSaved();
    } catch { setErr("Network error"); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white border border-gray-200 p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Plus className="h-4 w-4 text-sky-600" /> Enroll in Unit
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Student: <span className="text-sky-700 font-medium">{student.name}</span></p>
        <div className="space-y-3">
          <div>
            <label className={lbl}>Unit</label>
            <select value={unitId} onChange={e => setUnitId(e.target.value)} className={inp}>
              <option value="">Select a unit…</option>
              {available.map(u => (
                <option key={u.id} value={u.id}>{u.code} — {u.title} ({u.department?.name ?? ""})</option>
              ))}
            </select>
          </div>
          {available.length === 0 && <p className="text-xs text-gray-400">All available units are already enrolled.</p>}
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
            <button onClick={save} disabled={saving || available.length === 0}
              className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-medium text-gray-900 hover:bg-sky-500 disabled:opacity-60">
              {saving ? "Saving…" : "Enroll"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function StudentEnrollments({ student, allUnits, onChanged }: {
  student: Student; allUnits: Unit[]; onChanged: () => void;
}) {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetch(`/api/enrollments?studentId=${student.id}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any;
    setEnrollments(d.enrollments ?? d.data ?? d ?? []);
    setLoading(false);
  }, [student.id]);

  useEffect(() => { load(); }, [load]);

  const removeEnrollment = async (id: string) => {
    setDeleting(id);
    await fetch(`/api/enrollments/${id}`, { method: "DELETE", credentials: "include" });
    setDeleting(null);
    load(); onChanged();
  };

  return (
    <div className="pl-1 pt-2 space-y-1.5">
      {loading ? (
        <div className="text-xs text-gray-400 animate-pulse py-2">Loading enrollments…</div>
      ) : enrollments.length === 0 ? (
        <p className="text-xs text-gray-500 py-2">No units enrolled.</p>
      ) : enrollments.map(e => (
        <div key={e.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-sky-600 shrink-0" />
            <span className="text-xs font-mono text-sky-700">{e.unit?.code}</span>
            <span className="text-xs text-gray-500 hidden sm:inline">— {e.unit?.title}</span>
          </div>
          <button onClick={() => removeEnrollment(e.id)} disabled={deleting === e.id}
            className="text-gray-500 hover:text-rose-600 transition-colors disabled:opacity-40">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button onClick={() => setShowAdd(true)}
        className="flex items-center gap-1.5 text-xs text-sky-600 hover:text-sky-700 px-1 py-1">
        <Plus className="h-3.5 w-3.5" /> Add unit
      </button>
      <AnimatePresence>
        {showAdd && (
          <AddEnrollmentModal student={student} allUnits={allUnits} existing={enrollments}
            onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); onChanged(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function EnrollmentsPage() {
  const admin = useAcademicRegistrar();
  const [students, setStudents] = useState<Student[]>([]);
  const [allUnits, setAllUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    const [s, u] = await Promise.all([
      fetch(`/api/students?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/units?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
    ]);
    setStudents(s.students ?? s.data ?? s ?? []);
    setAllUnits(u.units ?? u.data ?? u ?? []);
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const q = search.toLowerCase();
  const filtered = students.filter(s =>
    !q || s.name.toLowerCase().includes(q) || s.admissionNumber.toLowerCase().includes(q)
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-sky-600" /> Enrollments
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage unit enrollments per student</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search student by name or admission number…"
          className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/50" />
      </div>

      <div className="space-y-2">
        {loading ? (
          [...Array(6)].map((_, i) => <div key={i} className="h-14 rounded-2xl bg-gray-200 border border-gray-100 animate-pulse" />)
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 rounded-2xl border border-gray-200 bg-white">
            <AlertTriangle className="h-7 w-7 text-slate-700" />
            <p className="text-sm text-gray-400">{search ? "No students match your search" : "No students yet"}</p>
          </div>
        ) : filtered.map(s => {
          const open = expanded.has(s.id);
          return (
            <div key={s.id} className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
              <button className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50"
                onClick={() => toggle(s.id)}>
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-600 text-xs font-bold">
                    {s.name[0]?.toUpperCase()}
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-medium text-gray-900 leading-tight">{s.name}</div>
                    <div className="text-xs text-gray-400">{s.admissionNumber} · {s.department?.name ?? ""} · {s.course?.name ?? ""}</div>
                  </div>
                </div>
                {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                    className="overflow-hidden border-t border-gray-200 px-4 pb-3">
                    <StudentEnrollments
                      student={s} allUnits={allUnits}
                      onChanged={() => setRefreshKey(k => k + 1)} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
