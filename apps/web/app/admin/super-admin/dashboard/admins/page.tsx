"use client";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, Plus, X, RefreshCw, Search, Eye, EyeOff } from "lucide-react";

interface AdminRow {
  id: string;
  fullName: string;
  email: string;
  role: string;
  createdAt: string;
  institutionId: string | null;
  departmentId: string | null;
  institution: { name: string } | null;
  department: { name: string } | null;
}

interface Institution { id: string; name: string }

const ROLE_COLORS: Record<string, string> = {
  super_admin:        "bg-violet-500/20 text-violet-700",
  system_admin:       "bg-indigo-500/20 text-indigo-700",
  academic_registrar: "bg-purple-500/20 text-purple-700",
  facilities_manager: "bg-orange-500/20 text-orange-700",
};

const inp =
  "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500";
const lbl = "block text-xs font-medium text-gray-500 mb-1.5";

export default function AdminsPage() {
  const [admins, setAdmins]         = useState<AdminRow[]>([]);
  const [filtered, setFiltered]     = useState<AdminRow[]>([]);
  const [institutions, setInsts]    = useState<Institution[]>([]);
  const [search, setSearch]         = useState("");
  const [instFilter, setInstFilter] = useState("");
  const [loading, setLoading]       = useState(true);

  // Create admin modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    fullName: "", email: "", password: "",
    institutionId: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState<string | null>(null);
  const [err, setErr]       = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [aRes, iRes] = await Promise.all([
        fetch("/api/admins"),
        fetch("/api/institutions"),
      ]);
      if (aRes.ok) {
        const d = await aRes.json();
        // Super-admin only manages system admins
        setAdmins((d.admins ?? []).filter((a: AdminRow) => a.role === "system_admin"));
      }
      if (iRes.ok) {
        const d = await iRes.json();
        setInsts(Array.isArray(d) ? d : []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    let list = admins;
    if (search)      list = list.filter(a => a.fullName.toLowerCase().includes(search.toLowerCase()) || a.email.toLowerCase().includes(search.toLowerCase()));
    if (instFilter)  list = list.filter(a => a.institutionId === instFilter);
    setFiltered(list);
  }, [admins, search, instFilter]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!form.fullName || !form.email || !form.password) return setErr("All required fields must be filled.");
    if (!form.institutionId) return setErr("Please select an institution.");
    setSaving(true);
    try {
      const r = await fetch("/api/auth/admin/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email,
          password: form.password,
          role: "system_admin",
          institutionId: form.institutionId,
        }),
      });
      const d = await r.json();
      if (!r.ok) return setErr(d.error ?? "Failed to create admin.");
      showToast(`Institution admin "${form.fullName}" assigned.`);
      setShowCreate(false);
      setForm({ fullName: "", email: "", password: "", institutionId: "" });
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
          <h1 className="text-xl font-bold text-gray-900">Institution Admins</h1>
          <p className="text-sm text-gray-500 mt-0.5">{admins.length} institution admin{admins.length !== 1 ? "s" : ""} onboarded</p>
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
            onClick={() => { setShowCreate(true); setErr(null); }}
            className="flex items-center gap-2 rounded-xl bg-violet-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-violet-600 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Assign Institution Admin
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={`${inp} pl-9`}
          />
        </div>
        <select
          value={instFilter}
          onChange={e => setInstFilter(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-500/50"
        >
          <option value="">All Institutions</option>
          {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>

      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Institution</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-200/50">
                    <td colSpan={4} className="px-4 py-3">
                      <div className="h-4 rounded-md bg-gray-200 animate-pulse w-3/4" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-gray-400">No institution admins found.</td>
                </tr>
              ) : (
                filtered.map((a, i) => (
                  <motion.tr
                    key={a.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.025 }}
                    className="border-b border-gray-200/50 hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/20 text-violet-700 text-xs font-bold shrink-0">
                          {a.fullName.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-800">{a.fullName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{a.email}</td>
                    <td className="px-4 py-3 text-gray-500">{a.institution?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">
                      {new Date(a.createdAt).toLocaleDateString()}
                    </td>
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
            <motion.div key="bk" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-black/60" onClick={() => setShowCreate(false)} />
            <motion.div key="md" initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white border border-gray-200 p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-semibold text-gray-900">Assign Institution Admin</h2>
                  <button onClick={() => setShowCreate(false)} className="rounded-lg p-1 text-gray-500 hover:text-gray-900"><X className="h-4 w-4" /></button>
                </div>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className={lbl}>Full Name</label>
                    <input type="text" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Jane Doe" className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Email</label>
                    <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@example.com" className={inp} />
                  </div>
                  <div>
                    <label className={lbl}>Password</label>
                    <div className="relative">
                      <input type={showPw ? "text" : "password"} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 6 characters" className={`${inp} pr-10`} />
                      <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={lbl}>Institution</label>
                    <select value={form.institutionId} onChange={e => setForm(f => ({ ...f, institutionId: e.target.value }))} className={inp}>
                      <option value="">— Select institution —</option>
                      {institutions.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                  </div>
                  {err && <p className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-600">{err}</p>}
                  <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
                    <button type="submit" disabled={saving} className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-violet-600 disabled:opacity-50 transition-colors">{saving ? "Saving…" : "Create Admin"}</button>
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
