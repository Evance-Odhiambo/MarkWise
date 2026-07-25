"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, Search, Plus, X, UserPlus, ChevronLeft, ChevronRight,
  Upload, AlertTriangle, Pencil, Trash2,
} from "lucide-react";
import { useDepartmentAdmin } from "../../context";

const inp = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500";
const lbl = "block text-xs font-medium text-gray-500 mb-1.5";
const PAGE = 25;

interface Student {
  id: string; name: string; admissionNumber: string;
  email: string | null; courseId: string; departmentId: string;
  course?: { name: string };
  auth?: { id: string } | null;
  _count?: { enrollments: number };
}
interface Course { id: string; name: string; code: string; departmentId: string }

function AddStudentModal({ courses, departmentId, onClose, onSaved }: {
  courses: Course[]; departmentId: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: "", admissionNumber: "", courseId: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!form.name || !form.admissionNumber || !form.courseId) {
      setErr("All fields required"); return;
    }
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/students", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, departmentId }),
      });
      if (!r.ok) { const j = await r.json(); setErr(j.error ?? "Failed"); setSaving(false); return; }
      onSaved();
    } catch { setErr("Network error"); setSaving(false); }
  };

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <>
      <motion.div
        key="admit-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      <motion.div
        key="admit-card"
        initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.93, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white text-gray-900 p-6 shadow-2xl pointer-events-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-teal-600" /> Admit Student
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <div><label className={lbl}>Full Name</label><input value={form.name} onChange={f("name")} className={inp} placeholder="e.g. Jane Osei" /></div>
          <div><label className={lbl}>Admission Number</label><input value={form.admissionNumber} onChange={f("admissionNumber")} className={inp} placeholder="e.g. CS/2024/001" /></div>
          <div><label className={lbl}>Course / Programme</label>
            <select value={form.courseId} onChange={f("courseId")} className={inp}>
              <option value="">Select course</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
            </select>
          </div>
          <p className="text-xs text-gray-400">The student will add their email and password when creating their account.</p>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
            <button onClick={save} disabled={saving}
              className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60">
              {saving ? "Saving…" : "Admit"}
            </button>
          </div>
        </div>
      </motion.div>
      </div>
    </>
  );
}

function EditStudentModal({ student, courses, onClose, onSaved }: {
  student: Student; courses: Course[];
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: student.name, admissionNumber: student.admissionNumber, courseId: student.courseId });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!form.name || !form.admissionNumber || !form.courseId) {
      setErr("All fields required"); return;
    }
    setSaving(true); setErr("");
    try {
      const r = await fetch(`/api/students/${student.id}`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) { const j = await r.json(); setErr(j.error ?? "Failed"); setSaving(false); return; }
      onSaved();
    } catch { setErr("Network error"); setSaving(false); }
  };

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <>
      <motion.div
        key="edit-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      <motion.div
        key="edit-card"
        initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.93, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white text-gray-900 p-6 shadow-2xl pointer-events-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Pencil className="h-4 w-4 text-amber-600" /> Edit Student
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <div><label className={lbl}>Full Name</label><input value={form.name} onChange={f("name")} className={inp} /></div>
          <div><label className={lbl}>Admission Number</label><input value={form.admissionNumber} onChange={f("admissionNumber")} className={inp} /></div>
          <div><label className={lbl}>Course / Programme</label>
            <select value={form.courseId} onChange={f("courseId")} className={inp}>
              <option value="">Select course</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
            </select>
          </div>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
            <button onClick={save} disabled={saving}
              className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60">
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </motion.div>
      </div>
    </>
  );
}

function DeleteConfirmModal({ student, onClose, onDeleted }: {
  student: Student;
  onClose: () => void; onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");

  const confirm = async () => {
    setDeleting(true); setErr("");
    try {
      const r = await fetch(`/api/students/${student.id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) { const j = await r.json(); setErr(j.error ?? "Failed"); setDeleting(false); return; }
      onDeleted();
    } catch { setErr("Network error"); setDeleting(false); }
  };

  return (
    <>
      <motion.div
        key="del-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      <motion.div
        key="del-card"
        initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.93, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white text-gray-900 p-6 shadow-2xl pointer-events-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-rose-700 flex items-center gap-2">
            <Trash2 className="h-4 w-4" /> Remove Student
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-sm text-gray-600 mb-1">Are you sure you want to remove <span className="font-semibold text-gray-800">{student.name}</span>?</p>
        <p className="text-xs text-gray-400 mb-5">This will permanently delete all their data including enrollments and attendance records.</p>
        {err && <p className="text-xs text-rose-600 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
          <button onClick={confirm} disabled={deleting}
            className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60">
            {deleting ? "Removing…" : "Remove"}
          </button>
        </div>
      </motion.div>
      </div>
    </>
  );
}

function BulkImportModal({ institutionId, departmentId, courses, onClose, onSaved }: {
  institutionId: string; departmentId: string; courses: Course[];
  onClose: () => void; onSaved: () => void;
}) {
  const [csv, setCsv] = useState("");
  const [courseId, setCourseId] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  const save = async () => {
    const rows = csv.trim().split("\n").map(l => l.trim()).filter(Boolean);
    if (!rows.length || !courseId) { setErr("CSV rows and course are required"); return; }
    const students = rows.map(r => {
      const [name, admissionNumber] = r.split(",").map(s => s.trim());
      return { name, admissionNumber, courseId, departmentId, institutionId };
    });
    setSaving(true); setErr(""); setResult(null);
    try {
      const r = await fetch("/api/students/bulk", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ students }),
      });
      const j = await r.json() as any;
      if (!r.ok) { setErr(j.error ?? "Failed"); setSaving(false); return; }
      setResult({ created: j.created ?? students.length, skipped: j.skipped ?? 0 });
      onSaved();
    } catch { setErr("Network error"); }
    setSaving(false);
  };

  return (
    <>
      <motion.div
        key="bulk-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      <motion.div
        key="bulk-card"
        initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.93, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white text-gray-900 p-6 shadow-2xl pointer-events-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Upload className="h-4 w-4 text-sky-600" /> Bulk Import Students
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <p className="text-xs text-gray-400 mb-4">Paste CSV rows: <span className="font-mono text-gray-500">Name, AdmissionNumber</span> (one per line). Students add their own email &amp; password at sign-up.</p>
        <div className="space-y-3">
          <textarea value={csv} onChange={e => setCsv(e.target.value)} rows={6}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-xs text-gray-800 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
            placeholder={"Jane Osei, CS/2024/001\nKwame Asante, CS/2024/002"} />
          <div><label className={lbl}>Course</label>
            <select value={courseId} onChange={e => setCourseId(e.target.value)} className={inp.replace("teal","sky")}>
              <option value="">Select course</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
            </select>
          </div>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          {result && <p className="text-xs text-emerald-600">✓ Created {result.created}, skipped {result.skipped}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50">Close</button>
            <button onClick={save} disabled={saving}
              className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60">
              {saving ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      </motion.div>
      </div>
    </>
  );
}

export default function DeptStudentsPage() {
  const admin = useDepartmentAdmin();
  const [students, setStudents] = useState<Student[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [deleteStudent, setDeleteStudent] = useState<Student | null>(null);
  const debouncedRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!admin?.departmentId) return;
    setLoading(true);
    const [s, c] = await Promise.all([
      fetch(`/api/students?departmentId=${admin.departmentId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/courses?departmentId=${admin.departmentId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
    ]);
    setStudents(s.students ?? s.data ?? s ?? []);
    setCourses(c.courses ?? c.data ?? c ?? []);
    setLoading(false);
  }, [admin?.departmentId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (debouncedRef.current) clearTimeout(debouncedRef.current);
    debouncedRef.current = setTimeout(() => setPage(1), 300);
  }, [search]);

  const filtered = students.filter(s => {
    const q = search.toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.admissionNumber.toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const slice = filtered.slice((page - 1) * PAGE, page * PAGE);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Users className="h-5 w-5 text-teal-600" /> Students
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">{students.length} registered · {filtered.length} shown · {admin?.departmentName}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowBulk(true)}
            className="flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2 text-sm font-medium text-sky-600 hover:bg-sky-500/20">
            <Upload className="h-4 w-4" /> Bulk Import
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-700">
            <Plus className="h-4 w-4" /> Admit Student
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, admission no, or email…"
          className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50" />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Admission No.</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 hidden lg:table-cell">Course</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Account</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 hidden sm:table-cell">Units</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="border-b border-gray-200/50">
                    {[1,2,3,4,5].map(j => (
                      <td key={j} className="px-4 py-3"><div className="h-5 rounded bg-gray-200 animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : slice.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <AlertTriangle className="h-7 w-7 text-slate-700" />
                      <p className="text-gray-400">{search ? "No students match your search" : "No students registered yet"}</p>
                    </div>
                  </td>
                </tr>
              ) : slice.map((s, i) => (
                <motion.tr key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-gray-200/50 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-teal-600 text-xs font-bold">
                        {s.name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-gray-800 leading-tight">{s.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.admissionNumber}</td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{s.course?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    {s.auth
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">&#10003; Active</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-400">Pending</span>
                    }
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-sm font-semibold text-gray-700">{s._count?.enrollments ?? 0}</span>
                    <span className="text-xs text-gray-400 ml-1">unit{(s._count?.enrollments ?? 0) !== 1 ? "s" : ""}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => setEditStudent(s)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                        title="Edit student">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteStudent(s)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        title="Remove student">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
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
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAdd && admin && (
          <AddStudentModal courses={courses} departmentId={admin.departmentId}
            onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
        )}
        {showBulk && admin && (
          <BulkImportModal institutionId={admin.institutionId} departmentId={admin.departmentId} courses={courses}
            onClose={() => setShowBulk(false)} onSaved={() => { setShowBulk(false); load(); }} />
        )}
        {editStudent && (
          <EditStudentModal student={editStudent} courses={courses}
            onClose={() => setEditStudent(null)} onSaved={() => { setEditStudent(null); load(); }} />
        )}
        {deleteStudent && (
          <DeleteConfirmModal student={deleteStudent}
            onClose={() => setDeleteStudent(null)} onDeleted={() => { setDeleteStudent(null); load(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}
