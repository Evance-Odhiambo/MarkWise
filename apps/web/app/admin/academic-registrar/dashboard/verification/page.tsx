"use client";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, Search, CheckCircle2, XCircle, UserCircle, BookOpen, Building2,
  Smartphone, GraduationCap, TrendingUp,
} from "lucide-react";
import { useAcademicRegistrar } from "../../context";

interface EnrolledUnit {
  unitCode: string;
  unitTitle: string;
  attended: number;
  total: number;
  pct: number;
}

interface VerifiedStudent {
  fullName: string; admissionNumber: string; email: string | null;
  course?: { name: string; code: string } | null; department?: { name: string } | null;
  exists: boolean;
  hasAppAccount: boolean;
  enrolledUnitCount: number;
  enrolledUnits: EnrolledUnit[];
}

export default function VerificationPage() {
  const admin = useAcademicRegistrar();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifiedStudent | null | "notfound">(null);
  const [searched, setSearched] = useState(false);

  const verify = async () => {
    if (!query.trim() || !admin?.institutionId) return;
    setLoading(true); setSearched(true); setResult(null);
    const d = await fetch(
      `/api/students/verify?admissionNumber=${encodeURIComponent(query.trim())}&institutionId=${admin.institutionId}`,
      { credentials: "include" }
    ).then(r => r.ok ? r.json() : null) as VerifiedStudent | null;
    // API returns { exists: bool, fullName, admissionNumber, course, department, email }
    if (d?.exists) {
      setResult(d);
    } else {
      setResult("notfound");
    }
    setLoading(false);
  };

  const found = result && result !== "notfound";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-rose-600" /> Student Verification
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Verify a student's identity using their admission number</p>
      </div>

      {/* Search bar */}
      <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5">
        <label className="block text-xs font-medium text-gray-500 mb-2">Admission Number</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && verify()}
              placeholder="e.g. CS/2024/001"
              className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50" />
          </div>
          <button onClick={verify} disabled={loading || !query.trim()}
            className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-rose-500 disabled:opacity-50">
            {loading ? "Looking up…" : "Verify"}
          </button>
        </div>
      </div>

      {/* Result */}
      <AnimatePresence mode="wait">
        {loading && (
          <motion.div key="loader" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="rounded-2xl border border-gray-200 bg-white p-8 flex justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-10 w-10 rounded-full border-2 border-rose-500 border-t-transparent animate-spin" />
              <p className="text-sm text-gray-500">Searching registry…</p>
            </div>
          </motion.div>
        )}

        {!loading && searched && result === "notfound" && (
          <motion.div key="notfound" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-500/15">
              <XCircle className="h-7 w-7 text-rose-600" />
            </div>
            <div>
              <p className="font-semibold text-rose-700">Student Not Found</p>
              <p className="text-sm text-gray-500 mt-0.5">No student with admission number <span className="font-mono text-rose-600">{query}</span> is registered at this institution.</p>
            </div>
          </motion.div>
        )}

        {!loading && found && typeof result === "object" && result !== null && (
          <motion.div key="found" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="rounded-2xl border border-emerald-500/30 bg-white border border-gray-200 overflow-hidden">
            {/* Verified banner */}
            <div className="flex items-center gap-3 px-5 py-3 bg-emerald-500/10 border-b border-emerald-500/20">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span className="text-sm font-semibold text-emerald-700">VERIFIED — Student record found</span>
            </div>
            {/* Student details */}
            <div className="p-5 flex flex-col sm:flex-row gap-5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-700 text-2xl font-bold self-start">
                {result.fullName[0]?.toUpperCase()}
              </div>
              <div className="flex-1 grid sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><UserCircle className="h-3 w-3" /> Full Name</div>
                  <div className="text-gray-800 font-semibold">{result.fullName}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-0.5">Admission No.</div>
                  <div className="font-mono text-emerald-600 font-medium">{result.admissionNumber}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><BookOpen className="h-3 w-3" /> Course</div>
                  <div className="text-gray-700">{result.course?.name ?? "—"} <span className="text-gray-400 text-xs">({result.course?.code ?? "—"})</span></div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><Building2 className="h-3 w-3" /> Department</div>
                  <div className="text-gray-700">{result.department?.name ?? "—"}</div>
                </div>
                {result.email && (
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Email</div>
                    <div className="text-gray-700 text-sm">{result.email}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><Smartphone className="h-3 w-3" /> App Account</div>
                  {result.hasAppAccount ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                      <XCircle className="h-3 w-3" /> Not Registered
                    </span>
                  )}
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-0.5 flex items-center gap-1"><GraduationCap className="h-3 w-3" /> Enrolled Units</div>
                  {result.enrolledUnitCount > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                      {result.enrolledUnitCount} unit{result.enrolledUnitCount !== 1 ? "s" : ""}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                      No enrollments
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Per-unit attendance breakdown */}
            {result.enrolledUnits && result.enrolledUnits.length > 0 && (
              <div className="border-t border-gray-100 px-5 py-4">
                <h3 className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-violet-600" /> Unit Attendance
                </h3>
                <div className="space-y-2.5">
                  {result.enrolledUnits.map(u => (
                    <div key={u.unitCode} className="flex items-center gap-3">
                      <div className="w-32 shrink-0">
                        <span className="font-mono text-xs text-violet-700 block">{u.unitCode}</span>
                        {u.unitTitle && <span className="text-xs text-gray-400 truncate block">{u.unitTitle}</span>}
                      </div>
                      <div className="flex-1 h-1.5 rounded-full bg-gray-200">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${u.pct}%`, backgroundColor: u.pct >= 75 ? "#34d399" : u.pct >= 50 ? "#f59e0b" : "#f87171" }} />
                      </div>
                      <span className={`text-xs font-medium w-10 text-right shrink-0 ${
                        u.pct >= 75 ? "text-emerald-600" : u.pct >= 50 ? "text-amber-600" : "text-rose-600"
                      }`}>{u.total > 0 ? `${u.pct}%` : "—"}</span>
                      <span className="text-xs text-gray-400 w-12 shrink-0">{u.attended}/{u.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
