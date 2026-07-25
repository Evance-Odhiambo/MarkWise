"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, Search, Plus, X, AlertTriangle } from "lucide-react";
import { useDepartmentAdmin } from "../../context";

const inp = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500";
const lbl = "block text-xs font-medium text-gray-500 mb-1.5";

interface Course { id: string; code: string; name: string; departmentId: string; programId?: string; program?: { name: string } }
interface Program { id: string; name: string }

function AddCourseModal({ programs, institutionId, departmentId, onClose, onSaved }: {
  programs: Program[]; institutionId: string; departmentId: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ name: "", code: "", programId: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!form.name || !form.code) { setErr("Name and code required"); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/courses", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, departmentId, institutionId }),
      });
      if (!r.ok) { const j = await r.json(); setErr(j.error ?? "Failed"); setSaving(false); return; }
      onSaved();
    } catch { setErr("Network error"); setSaving(false); }
  };

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <>
      <motion.div key="course-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
      <motion.div key="course-card" initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.93, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white text-gray-900 p-6 shadow-2xl pointer-events-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Plus className="h-4 w-4 text-teal-600" /> Add Course
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Course Code</label><input value={form.code} onChange={f("code")} className={inp} placeholder="e.g. CS401" /></div>
            <div><label className={lbl}>Programme (optional)</label>
              <select value={form.programId} onChange={f("programId")} className={inp}>
                <option value="">None</option>
                {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div><label className={lbl}>Course Name</label><input value={form.name} onChange={f("name")} className={inp} placeholder="e.g. Data Structures & Algorithms" /></div>
          {err && <p className="text-xs text-rose-600">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
            <button onClick={save} disabled={saving}
              className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60">
              {saving ? "Saving…" : "Add Course"}
            </button>
          </div>
        </div>
      </motion.div>
      </div>
    </>
  );
}

export default function DeptCoursesPage() {
  const admin = useDepartmentAdmin();
  const [courses, setCourses] = useState<Course[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    if (!admin?.departmentId) return;
    setLoading(true);
    const [c, pg] = await Promise.all([
      fetch(`/api/courses?departmentId=${admin.departmentId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/programs?departmentId=${admin.departmentId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
    ]);
    setCourses(c.courses ?? c.data ?? c ?? []);
    setPrograms(pg.programs ?? pg.data ?? pg ?? []);
    setLoading(false);
  }, [admin?.departmentId]);

  useEffect(() => { load(); }, [load]);

  const q = search.toLowerCase();
  const filtered = courses.filter(c =>
    !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-teal-600" /> Courses
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">{courses.length} courses · {admin?.departmentName}</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-teal-700">
          <Plus className="h-4 w-4" /> Add Course
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by code or name…"
          className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/50" />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 hidden lg:table-cell">Programme</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(7)].map((_, i) => (
                  <tr key={i} className="border-b border-gray-200/50">
                    {[1,2,3].map(j => <td key={j} className="px-4 py-3"><div className="h-5 rounded bg-gray-200 animate-pulse" /></td>)}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <AlertTriangle className="h-7 w-7 text-slate-700" />
                      <p className="text-gray-400">{search ? "No courses match your search" : "No courses yet"}</p>
                    </div>
                  </td>
                </tr>
              ) : filtered.map((c, i) => (
                <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-gray-200/50 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <span className="rounded-lg bg-teal-500/10 px-2 py-1 text-teal-600">{c.code}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800">{c.name}</td>
                  <td className="px-4 py-3 text-gray-400 hidden lg:table-cell">{c.program?.name ?? "—"}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {showAdd && admin && (
          <AddCourseModal programs={programs} institutionId={admin.institutionId} departmentId={admin.departmentId}
            onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
        )}
      </AnimatePresence>
    </div>
  );
}
