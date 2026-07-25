"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, Plus, X, RefreshCw, Search,
  Users, GraduationCap, DoorOpen, Globe,
} from "lucide-react";

interface Institution {
  id: string;
  name: string;
  logoUrl: string | null;
  _count: { admins: number; lecturers: number; students: number; departments: number };
}

const inp =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500";
const lbl = "block text-xs font-medium text-gray-500 mb-1.5";

export default function InstitutionsPage() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [filtered, setFiltered]         = useState<Institution[]>([]);
  const [search, setSearch]             = useState("");
  const [loading, setLoading]           = useState(true);

  // Create institution modal
  const [showCreate, setShowCreate] = useState(false);
  const [instName, setInstName]     = useState("");
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState<string | null>(null);
  const [err, setErr]               = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/super/institutions");
      if (r.ok) {
        const d = await r.json();
        const list: Institution[] = d.institutions ?? [];
        setInstitutions(list);
        setFiltered(list);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(
      q ? institutions.filter(i => i.name.toLowerCase().includes(q)) : institutions,
    );
  }, [search, institutions]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!instName.trim()) return setErr("Institution name is required.");
    setSaving(true);
    try {
      const r = await fetch("/api/super/institutions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: instName.trim() }),
      });
      const d = await r.json();
      if (!r.ok) return setErr(d.error ?? "Failed to create institution.");
      showToast(`Institution "${d.institution.name}" created.`);
      setShowCreate(false);
      setInstName("");
      load();
    } catch {
      setErr("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-4 right-4 z-50 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-gray-900 shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Institutions</h1>
          <p className="text-sm text-gray-500 mt-0.5">{institutions.length} institution{institutions.length !== 1 ? "s" : ""} total</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="rounded-xl border border-gray-200 bg-white p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => { setShowCreate(true); setErr(null); setInstName(""); }}
            className="flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-violet-600 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Institution
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search institutions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={`${inp} pl-9`}
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Institution</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">
                  <Globe className="inline h-3.5 w-3.5 mr-1" />Depts
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">
                  <Users className="inline h-3.5 w-3.5 mr-1" />Students
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">
                  <GraduationCap className="inline h-3.5 w-3.5 mr-1" />Lecturers
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">
                  <DoorOpen className="inline h-3.5 w-3.5 mr-1" />Rooms
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-200/50">
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-4 rounded-md bg-gray-200 animate-pulse w-2/3" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                    {search ? "No institutions match your search." : "No institutions yet."}
                  </td>
                </tr>
              ) : (
                filtered.map((inst, i) => (
                  <motion.tr
                    key={inst.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-gray-200/50 hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 shrink-0">
                          <Building2 className="h-4 w-4 text-violet-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">{inst.name}</p>
                          <p className="text-xs text-gray-400 font-mono">{inst.id.slice(0, 8)}…</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700">{inst._count.departments}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{inst._count.students.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{inst._count.lecturers}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{inst._count.admins}</td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setShowCreate(false)}
            />
            <motion.div
              key="modal"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white border border-gray-200 p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-semibold text-gray-900">New Institution</h2>
                  <button onClick={() => setShowCreate(false)} className="rounded-lg p-1 text-gray-500 hover:text-gray-900">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className={lbl}>Institution Name</label>
                    <input
                      type="text"
                      value={instName}
                      onChange={e => setInstName(e.target.value)}
                      placeholder="e.g. University of Nairobi"
                      className={inp}
                      autoFocus
                    />
                  </div>

                  {err && <p className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-600">{err}</p>}

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-violet-600 disabled:opacity-50 transition-colors"
                    >
                      {saving ? "Creating…" : "Create Institution"}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
