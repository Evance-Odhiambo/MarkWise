"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, Plus, Search, X, CheckCircle2, Loader2,
} from "lucide-react";
import { useSystemAdmin } from "../../context";

interface Department {
  id: string;
  name: string;
  institutionId: string;
}

const inp = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500";
const lbl = "block text-xs font-medium text-gray-500 mb-1.5";

export default function DepartmentsPage() {
  const admin = useSystemAdmin();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [addOk, setAddOk] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchDepts = useCallback(async () => {
    if (!admin?.institutionId) { setLoading(false); return; }
    setLoading(true);
    const r = await fetch(`/api/departments?institutionId=${admin.institutionId}`, { credentials: "include" });
    if (r.ok) {
      const data = await r.json();
      setDepartments(Array.isArray(data) ? data : (data.departments ?? data.data ?? []));
    }
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { fetchDepts(); }, [fetchDepts]);

  const addDepartment = async () => {
    if (!newName.trim()) { setAddErr("Department name is required."); return; }
    setAdding(true); setAddErr(""); setAddOk(false);
    const r = await fetch("/api/departments", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), institutionId: admin?.institutionId }),
    });
    if (r.ok) {
      setAddOk(true);
      setNewName("");
      setShowAdd(false);
      await fetchDepts();
      setTimeout(() => setAddOk(false), 3000);
    } else {
      const j = await r.json();
      setAddErr(j.error ?? "Failed to create department.");
    }
    setAdding(false);
  };

  const confirmDelete = async (id: string) => {
    setDeleting(true);
    const r = await fetch(`/api/departments/${id}`, { method: "DELETE", credentials: "include" });
    if (r.ok) { await fetchDepts(); }
    setDeleteId(null);
    setDeleting(false);
  };

  const filtered = departments.filter(d =>
    d.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Departments</h1>
          <p className="text-xs text-gray-400 mt-0.5">{departments.length} department{departments.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddErr(""); setNewName(""); }}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-gray-900 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Department
        </button>
      </div>

      {addOk && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-sm text-emerald-600"
        >
          <CheckCircle2 className="h-4 w-4" />
          Department created successfully.
        </motion.div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-4 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          placeholder="Search departments..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              className="h-6 w-6 rounded-full border-2 border-indigo-600 border-t-transparent"
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Building2 className="h-10 w-10 text-slate-700 mb-3" />
            <p className="text-sm text-gray-400">
              {search ? "No departments match your search." : "No departments yet."}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-400">
                <th className="px-4 py-3 text-left font-medium">Department Name</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filtered.map((dept, i) => (
                <motion.tr
                  key={dept.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 shrink-0">
                        <Building2 className="h-3.5 w-3.5 text-sky-600" />
                      </div>
                      <span className="font-medium text-gray-900">{dept.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setDeleteId(dept.id)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 transition-colors"
                    >
                      Delete
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Department Modal */}
      <AnimatePresence>
        {showAdd && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setShowAdd(false)}
            />
            <motion.div
              key="modal"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white border border-gray-200 p-6 shadow-xl">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-semibold text-gray-800">Add Department</h2>
                  <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-700">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className={lbl}>Department Name</label>
                    <input
                      className={inp}
                      placeholder="e.g. Computer Science"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addDepartment(); }}
                    />
                  </div>
                  {addErr && <p className="text-xs text-red-600">{addErr}</p>}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setShowAdd(false)}
                      className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addDepartment}
                      disabled={adding}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2.5 text-sm font-medium text-gray-900 transition-colors"
                    >
                      {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {adding ? "Creating..." : "Create Department"}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete Confirm Modal */}
      <AnimatePresence>
        {deleteId && (
          <>
            <motion.div
              key="del-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setDeleteId(null)}
            />
            <motion.div
              key="del-modal"
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white border border-gray-200 p-6 shadow-xl">
                <h2 className="text-base font-semibold text-gray-800 mb-2">Delete Department?</h2>
                <p className="text-sm text-gray-500 mb-5">
                  This will permanently delete{" "}
                  <span className="font-medium text-gray-900">
                    {departments.find(d => d.id === deleteId)?.name}
                  </span>{" "}
                  and all its associated data.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteId(null)}
                    className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => confirmDelete(deleteId)}
                    disabled={deleting}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 py-2.5 text-sm font-medium text-gray-900 transition-colors"
                  >
                    {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
