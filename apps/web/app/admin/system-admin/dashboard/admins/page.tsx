"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, Plus, Search, X, CheckCircle2, Loader2, User, Eye, EyeOff,
} from "lucide-react";
import { useSystemAdmin } from "../../context";

interface AdminRecord {
  id: string;
  fullName: string;
  email: string;
  role: string;
  createdAt: string;
  departmentId: string | null;
  department: { name: string } | null;
}

interface Department {
  id: string;
  name: string;
}

const ROLES = [
  { value: "system_admin",       label: "System Administrator" },
  { value: "academic_registrar", label: "Academic Registrar" },
  { value: "facilities_manager", label: "Facilities Manager" },
];

const inp = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500";
const lbl = "block text-xs font-medium text-gray-500 mb-1.5";

function roleBadge(role: string) {
  const map: Record<string, string> = {
    system_admin:       "bg-indigo-500/10 text-indigo-600",
    academic_registrar: "bg-purple-500/10 text-purple-600",
    facilities_manager: "bg-orange-500/10 text-orange-600",
  };
  return map[role] ?? "bg-slate-500/10 text-gray-500";
}

export default function AdminsPage() {
  const admin = useSystemAdmin();
  const [admins, setAdmins] = useState<AdminRecord[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: "academic_registrar", departmentId: "" });
  const [showPw, setShowPw] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [addOk, setAddOk] = useState(false);

  const fetchData = useCallback(async () => {
    if (!admin?.institutionId) { setLoading(false); return; }
    const iid = admin.institutionId;
    setLoading(true);
    const [aRes, dRes] = await Promise.all([
      fetch(`/api/admins?institutionId=${iid}`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`/api/departments?institutionId=${iid}`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
    ]);
    setAdmins(aRes?.admins ?? []);
    const depts = dRes?.departments ?? dRes?.data ?? (Array.isArray(dRes) ? dRes : []);
    setDepartments(depts);
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const createAdmin = async () => {
    if (!form.fullName.trim()) { setAddErr("Full name is required."); return; }
    if (!form.email.trim())    { setAddErr("Email is required."); return; }
    if (!form.password || form.password.length < 6) { setAddErr("Password must be at least 6 characters."); return; }
    setAdding(true); setAddErr(""); setAddOk(false);
    const r = await fetch("/api/auth/admin/signup", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: form.fullName.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role: form.role,
        institutionId: admin?.institutionId,
        ...(form.departmentId ? { departmentId: form.departmentId } : {}),
      }),
    });
    if (r.ok) {
      setAddOk(true);
      setForm({ fullName: "", email: "", password: "", role: "academic_registrar", departmentId: "" });
      setShowAdd(false);
      await fetchData();
      setTimeout(() => setAddOk(false), 3000);
    } else {
      const j = await r.json();
      setAddErr(j.error ?? "Failed to create admin.");
    }
    setAdding(false);
  };

  const filtered = admins.filter(a => {
    const matchSearch = a.fullName.toLowerCase().includes(search.toLowerCase()) ||
      a.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === "all" || a.role === roleFilter;
    return matchSearch && matchRole;
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Admins</h1>
          <p className="text-xs text-gray-400 mt-0.5">{admins.length} admin account{admins.length !== 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddErr(""); }}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-gray-900 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Admin
        </button>
      </div>

      {addOk && (
        <motion.div
          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-sm text-emerald-600"
        >
          <CheckCircle2 className="h-4 w-4" />
          Admin account created successfully.
        </motion.div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-4 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            placeholder="Search by name or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
        >
          <option value="all">All Roles</option>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
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
            <ShieldCheck className="h-10 w-10 text-slate-700 mb-3" />
            <p className="text-sm text-gray-400">
              {search || roleFilter !== "all" ? "No admins match your filters." : "No admin accounts yet."}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-400">
                <th className="px-4 py-3 text-left font-medium">Admin</th>
                <th className="px-4 py-3 text-left font-medium hidden sm:table-cell">Role</th>
                <th className="px-4 py-3 text-left font-medium hidden md:table-cell">Department</th>
                <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filtered.map((a, i) => (
                <motion.tr
                  key={a.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/10 shrink-0">
                        <User className="h-3.5 w-3.5 text-indigo-600" />
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{a.fullName}</div>
                        <div className="text-xs text-gray-400">{a.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium ${roleBadge(a.role)}`}>
                      {ROLES.find(r => r.value === a.role)?.label ?? a.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-gray-500">
                    {a.department?.name ?? <span className="text-gray-500">—</span>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-400 text-xs">
                    {new Date(a.createdAt).toLocaleDateString()}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Admin Modal */}
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
              <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white border border-gray-200 p-6 shadow-xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-base font-semibold text-gray-800">Add Admin Account</h2>
                  <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-700">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className={lbl}>Full Name</label>
                    <input className={inp} placeholder="e.g. Jane Doe" value={form.fullName}
                      onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} />
                  </div>
                  <div>
                    <label className={lbl}>Email Address</label>
                    <input className={inp} type="email" placeholder="admin@example.com" value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                  <div>
                    <label className={lbl}>Password</label>
                    <div className="relative">
                      <input
                        className={inp}
                        type={showPw ? "text" : "password"}
                        placeholder="Min. 6 characters"
                        value={form.password}
                        onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                      >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={lbl}>Role</label>
                    <select
                      className={inp}
                      value={form.role}
                      onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                    >
                      {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                  {false && (
                    <div>
                      <label className={lbl}>Department (optional)</label>
                      <select
                        className={inp}
                        value={form.departmentId}
                        onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))}
                      >
                        <option value="">Select department...</option>
                        {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                  )}
                  {addErr && <p className="text-xs text-red-600">{addErr}</p>}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setShowAdd(false)}
                      className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={createAdmin}
                      disabled={adding}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2.5 text-sm font-medium text-gray-900 transition-colors"
                    >
                      {adding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {adding ? "Creating..." : "Create Admin"}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
