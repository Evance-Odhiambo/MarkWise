"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Layers, ChevronDown, ChevronRight, BookOpen, Plus, X, AlertCircle } from "lucide-react";
import { useAcademicRegistrar } from "../../context";

interface Program { id: string; name: string; durationYears: number; departmentId: string }
interface Course  { id: string; name: string; code: string; programId: string; departmentId: string }
interface Department { id: string; name: string }

const inp = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500";
const lbl = "block text-xs font-medium text-gray-500 mb-1.5";

export default function FacultyProgramsPage() {
  const admin = useAcademicRegistrar();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showDeptId, setShowDeptId] = useState("all");
  const [addModal, setAddModal] = useState<"program" | "course" | null>(null);
  const [form, setForm] = useState({ name: "", durationYears: "3", departmentId: "", code: "", programId: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    const [d, p, c] = await Promise.all([
      fetch(`/api/departments?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/programs?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/courses?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
    ]);
    setDepartments(d.departments ?? d.data ?? d ?? []);
    setPrograms(p.programs ?? p.data ?? p ?? []);
    setCourses(c.courses ?? c.data ?? c ?? []);
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filteredPrograms = programs.filter(p => showDeptId === "all" || p.departmentId === showDeptId);

  async function handleSave() {
    if (addModal === "program" && (!form.name || !form.departmentId)) { setError("Name and department are required."); return; }
    if (addModal === "course" && (!form.name || !form.code || !form.programId)) { setError("Name, code and program are required."); return; }
    setSaving(true); setError("");
    const endpoint = addModal === "program" ? "/api/programs" : "/api/courses";
    const body = addModal === "program"
      ? { name: form.name, durationYears: Number(form.durationYears), departmentId: form.departmentId }
      : { name: form.name, code: form.code, programId: form.programId, departmentId: programs.find(p => p.id === form.programId)?.departmentId ?? "" };
    const res = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { setAddModal(null); setForm({ name: "", durationYears: "3", departmentId: "", code: "", programId: "" }); fetchAll(); }
    else { const d = await res.json().catch(() => ({})) as any; setError(d.error ?? "Failed to save"); }
    setSaving(false);
  }

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Programs &amp; Courses</h1>
          <p className="text-sm text-gray-400 mt-0.5">{programs.length} programs · {courses.length} courses institution-wide</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setAddModal("program"); setForm(f => ({ ...f, name: "", durationYears: "3" })); setError(""); }}
            className="flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 px-3.5 py-2 text-xs font-semibold text-gray-900 transition-colors">
            <Plus className="h-3.5 w-3.5" /> Program
          </button>
          <button onClick={() => { setAddModal("course"); setForm(f => ({ ...f, name: "", code: "", programId: "" })); setError(""); }}
            className="flex items-center gap-2 rounded-xl bg-slate-700 hover:bg-slate-600 px-3.5 py-2 text-xs font-semibold text-gray-800 transition-colors">
            <Plus className="h-3.5 w-3.5" /> Course
          </button>
        </div>
      </div>

      {/* Dept filter */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setShowDeptId("all")} className={`rounded-xl px-3.5 py-1.5 text-xs font-medium transition-colors ${showDeptId === "all" ? "bg-amber-600 text-gray-900" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>All</button>
        {departments.map(d => (
          <button key={d.id} onClick={() => setShowDeptId(d.id)} className={`rounded-xl px-3.5 py-1.5 text-xs font-medium transition-colors ${showDeptId === d.id ? "bg-amber-600 text-gray-900" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{d.name}</button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-2xl bg-gray-200 animate-pulse" />)}</div>
      ) : filteredPrograms.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12"><Layers className="h-8 w-8 text-slate-700" /><p className="text-sm text-gray-500">No programs found</p></div>
      ) : filteredPrograms.map(p => {
        const open = !!expanded[p.id];
        const progCourses = courses.filter(c => c.programId === p.id);
        const dept = departments.find(d => d.id === p.departmentId);
        return (
          <motion.div key={p.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
            <button onClick={() => setExpanded(e => ({ ...e, [p.id]: !e[p.id] }))}
              className="w-full flex items-center gap-3 px-4 py-4 hover:bg-gray-50 transition-colors text-left">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 shrink-0">
                <Layers className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900">{p.name}</div>
                <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                  <span>{dept?.name ?? "—"}</span>
                  <span>{p.durationYears} yr{p.durationYears !== 1 ? "s" : ""}</span>
                  <span>{progCourses.length} course{progCourses.length !== 1 ? "s" : ""}</span>
                </div>
              </div>
              {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
            </button>
            <AnimatePresence>
              {open && (
                <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-t border-gray-200">
                  {progCourses.length === 0 ? (
                    <p className="text-sm text-gray-500 px-4 py-4 text-center">No courses yet</p>
                  ) : (
                    <div className="divide-y divide-slate-800/60">
                      {progCourses.map(c => (
                        <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                          <BookOpen className="h-4 w-4 text-gray-500 shrink-0" />
                          <span className="text-sm text-gray-700 flex-1 truncate">{c.name}</span>
                          <span className="font-mono text-xs text-gray-400">{c.code}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}

      {/* Add modal */}
      <AnimatePresence>
        {addModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white border border-gray-200 p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-bold text-gray-800">Add {addModal === "program" ? "Program" : "Course"}</h2>
                <button onClick={() => setAddModal(null)} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-4">
                <div><label className={lbl}>Name <span className="text-red-600">*</span></label><input value={form.name} onChange={f("name")} className={inp} placeholder={addModal === "program" ? "e.g. Bachelor of Science" : "e.g. Algorithms"} /></div>
                {addModal === "program" && <>
                  <div><label className={lbl}>Duration (years)</label><input type="number" min={1} max={8} value={form.durationYears} onChange={f("durationYears")} className={inp} /></div>
                  <div><label className={lbl}>Department <span className="text-red-600">*</span></label>
                    <select value={form.departmentId} onChange={f("departmentId")} className={inp}>
                      <option value="">Select…</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                </>}
                {addModal === "course" && <>
                  <div><label className={lbl}>Code <span className="text-red-600">*</span></label><input value={form.code} onChange={f("code")} className={inp} placeholder="e.g. CS301" /></div>
                  <div><label className={lbl}>Program <span className="text-red-600">*</span></label>
                    <select value={form.programId} onChange={f("programId")} className={inp}>
                      <option value="">Select…</option>{programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </>}
                {error && <p className="text-xs text-red-600 flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" />{error}</p>}
              </div>
              <div className="mt-5 flex justify-end gap-3">
                <button onClick={() => setAddModal(null)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-gray-900 transition-colors">
                  {saving ? "Saving…" : <><Plus className="h-4 w-4" /> Save</>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
