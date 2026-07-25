"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, GraduationCap, BarChart3, Activity, AlertTriangle,
  CheckCircle2, AlertCircle, RefreshCw, TrendingDown,
  Shield, UserX, BookOpen, TrendingUp, Calendar, X,
  ChevronRight, User, Search, Loader2, ChevronDown,
  FileText, ClipboardList, Layers, FlaskConical, Cpu,
  ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { Fragment } from "react";
import { useDepartmentAdmin } from "../../context";

// ── Types ─────────────────────────────────────────────────────────────────
interface Overview {
  totalStudents: number; activeStudents: number; totalLecturers: number;
  totalSessions: number; overallAvgAttendance: number;
  atRiskCount: number; atRiskPct: number;
  criticalCount: number; criticalPct: number;
  lookbackDays: number;
}
interface LecturerUnitStat {
  unitCode: string; unitTitle: string;
  totalSessions: number; lecSessions: number;
  catSessions: number; ratSessions: number;
  labSessions: number; gdSessions: number;
  semSessions: number; assignmentsPosted: number;
  avgClassAttendance: number;
}
interface LecturerStat {
  lecturerId: string; lecturerName: string; department: string; departmentId: string;
  totalSessions: number; hoursPerWeek: number; unitCount: number;
  avgClassAttendance: number;
  catSessions: number; ratSessions: number; labSessions: number;
  assignmentsPosted: number;
  units?: LecturerUnitStat[];
}
interface YearBreakdown {
  year: number; totalStudents: number; avgAttendance: number;
  atRiskCount: number; atRiskPct: number;
}
interface PerCourseEntry { sessions: number; attended: number; }
interface AtRiskStudent {
  studentId: string; studentName: string; admissionNumber: string;
  year: number; department: string; overallAttendance: number; riskLevel: string;
  perCourseAttendance?: Record<string, PerCourseEntry>;
}
interface UnitStat {
  unitId: string; unitCode: string; unitTitle: string; department: string;
  sessionsHeld: number; enrolled: number; avgAttendance: number;
  atRiskCount: number; atRiskPct: number; lecturerName: string; lowActivity: boolean;
}
interface DistBucket { range: string; count: number; }
interface WeeklyPoint { week: string; sessions: number; avgPresent: number; }
interface DowPoint    { day: string; sessions: number; avgAttendancePct: number | null; }

interface CourseYearBreakdown {
  year: number; totalStudents: number; avgAttendance: number;
  atRiskCount: number; atRiskPct: number;
}
interface CourseTopAtRisk {
  studentId: string; studentName: string; admissionNumber: string;
  year: number; overallAttendance: number; riskLevel: string;
}
interface CourseStat {
  courseId: string; courseCode: string; courseName: string;
  totalStudents: number; activeStudents: number; avgAttendance: number;
  atRiskCount: number; criticalCount: number; atRiskPct: number;
  velocityDelta: number;
  yearBreakdown: CourseYearBreakdown[];
  topAtRisk: CourseTopAtRisk[];
}

interface AnalyticsData {
  overview: Overview;
  lecturers: LecturerStat[];
  students: {
    byDepartment: { departmentId: string; name: string; totalStudents: number; activeStudents: number; avgAttendance: number; atRiskCount: number; atRiskPct: number; }[];
    byYear: YearBreakdown[];
    byCourse?: CourseStat[];
    atRisk: AtRiskStudent[];
    critical: AtRiskStudent[];
  };
  units: UnitStat[];
  unitTitleMap?: Record<string, string>;
  distribution: DistBucket[];
  weeklyTrend: WeeklyPoint[];
  dowAbsenteeism: DowPoint[];
}

// ── Helpers ───────────────────────────────────────────────────────────────
function pctColor(pct: number): string {
  if (pct >= 75) return "text-emerald-600";
  if (pct >= 60) return "text-amber-600";
  return "text-rose-600";
}
function barColor(pct: number): string {
  if (pct >= 75) return "bg-emerald-500";
  if (pct >= 60) return "bg-amber-400";
  return "bg-rose-500";
}
function riskBadge(level: string): string {
  const m: Record<string, string> = {
    none:     "bg-emerald-100 text-emerald-700",
    watch:    "bg-amber-100 text-amber-700",
    warning:  "bg-orange-100 text-orange-700",
    critical: "bg-rose-100 text-rose-700",
  };
  return m[level] ?? "bg-gray-100 text-gray-600";
}



function Bar({
  pct, color, animated = true,
}: {
  pct: number; color: string; animated?: boolean;
}) {
  return (
    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
      {animated ? (
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className={`h-full rounded-full ${color}`}
        />
      ) : (
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}

function Skeleton({ w = "w-16", h = "h-5" }: { w?: string; h?: string }) {
  return <span className={`inline-block ${h} ${w} rounded bg-gray-200 animate-pulse`} />;
}

function KpiCard({
  icon: Icon, label, value, sub, color,
}: {
  icon: React.ElementType; label: string; value: React.ReactNode; sub?: string; color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start gap-4">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide truncate">{label}</p>
        <p className="text-2xl font-bold text-gray-800 leading-tight mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

type Tab = "overview" | "lecturers" | "students" | "units" | "courses" | "trends";

interface SearchResult { id: string; name: string; admissionNumber: string; year: number; }

// ── Student Search Widget ─────────────────────────────────────────────────
function StudentSearchWidget({
  departmentId,
  onSelect,
}: {
  departmentId: string;
  onSelect: (student: AtRiskStudent) => void;
}) {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<SearchResult[]>([]);
  const [loading, setLoading]   = useState(false);
  const [fetching, setFetching] = useState(false);
  const [open, setOpen]         = useState(false);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/admin/student-search?departmentId=${departmentId}&q=${encodeURIComponent(query)}`,
          { credentials: "include" },
        );
        if (res.ok) { setResults(await res.json()); setOpen(true); }
      } finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [query, departmentId]);

  async function handleSelect(r: SearchResult) {
    setOpen(false);
    setQuery("");
    setResults([]);
    setFetching(true);
    try {
      const res = await fetch(
        `/api/admin/student-attendance-detail?departmentId=${departmentId}&studentId=${r.id}`,
        { credentials: "include" },
      );
      if (res.ok) onSelect(await res.json());
    } finally { setFetching(false); }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-indigo-300">
        {fetching
          ? <Loader2 className="h-4 w-4 text-indigo-400 animate-spin shrink-0" />
          : <Search className="h-4 w-4 text-gray-400 shrink-0" />}
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search any student by name or admission number…"
          className="flex-1 text-sm bg-transparent outline-none text-gray-700 placeholder-gray-400"
        />
        {loading && <Loader2 className="h-3.5 w-3.5 text-gray-300 animate-spin shrink-0" />}
        {query && !loading && (
          <button onClick={() => { setQuery(""); setResults([]); setOpen(false); }} className="text-gray-300 hover:text-gray-500">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white rounded-xl border border-gray-100 shadow-lg overflow-hidden">
          {results.map(r => (
            <button
              key={r.id}
              onMouseDown={() => handleSelect(r)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-indigo-50 transition-colors"
            >
              <div>
                <p className="text-sm font-medium text-gray-800">{r.name}</p>
                <p className="text-xs text-gray-400">{r.admissionNumber} · Year {r.year}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
            </button>
          ))}
        </div>
      )}
      {open && results.length === 0 && !loading && query.trim().length >= 2 && (
        <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white rounded-xl border border-gray-100 shadow-lg px-4 py-3">
          <p className="text-sm text-gray-400">No students found for "{query}".</p>
        </div>
      )}
    </div>
  );
}

// ── Student Detail Drawer ─────────────────────────────────────────────────
function StudentDrawer({
  student,
  unitTitleMap,
  onClose,
}: {
  student: AtRiskStudent;
  unitTitleMap: Record<string, string>;
  onClose: () => void;
}) {
  const courses = Object.entries(student.perCourseAttendance ?? {});
  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />
      {/* Drawer panel */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
              <User className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-gray-800 leading-tight">{student.studentName}</p>
              <p className="text-xs text-gray-400 mt-0.5">{student.admissionNumber} · Year {student.year}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Overall attendance gauge */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center gap-4">
          <div className="text-center shrink-0">
            <p className={`text-3xl font-bold ${pctColor(student.overallAttendance)}`}>
              {student.overallAttendance}%
            </p>
            <p className="text-xs text-gray-400 mt-0.5">Overall</p>
          </div>
          <div className="flex-1">
            <div className="h-2.5 rounded-full bg-gray-200 overflow-hidden">
              <div
                className={`h-full rounded-full ${barColor(student.overallAttendance)}`}
                style={{ width: `${student.overallAttendance}%` }}
              />
            </div>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${riskBadge(student.riskLevel)}`}>
            {student.riskLevel.toUpperCase()}
          </span>
        </div>

        {/* Per-unit breakdown */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 py-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Per-Unit Attendance
            </h3>
            {courses.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">No unit-level data available.</p>
            ) : (
              <div className="space-y-3">
                {courses.map(([code, entry]) => {
                  const pct = entry.sessions > 0
                    ? Math.round((entry.attended / entry.sessions) * 100)
                    : 0;
                  const title = unitTitleMap[code] ?? "";
                  return (
                    <div key={code} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-800 leading-tight">{code}</p>
                          {title && <p className="text-xs text-gray-400 truncate">{title}</p>}
                        </div>
                        <span className={`text-sm font-bold shrink-0 ml-3 ${pctColor(pct)}`}>{pct}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${barColor(pct)}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">
                          {entry.attended}/{entry.sessions} sessions
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function DeptAttendanceAnalyticsPage() {
  const admin = useDepartmentAdmin();
  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [tab, setTab]         = useState<Tab>("overview");
  const [days, setDays]       = useState(30);
  const [selectedStudent, setSelectedStudent] = useState<AtRiskStudent | null>(null);
  const [searchDrawerStudent, setSearchDrawerStudent] = useState<AtRiskStudent | null>(null);
  const [expandedLecturer, setExpandedLecturer] = useState<string | null>(null);
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const activeDrawerStudent = searchDrawerStudent ?? selectedStudent;

  const fetchData = useCallback(async () => {
    if (!admin?.departmentId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/attendance-analytics?departmentId=${admin.departmentId}&institutionId=${admin.institutionId}&days=${days}`,
        { credentials: "include" },
      );
      if (res.ok) {
        setData(await res.json());
      } else {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? `Error ${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [admin?.departmentId, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const ov = data?.overview;

  return (
    <div className="space-y-6 p-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-indigo-500" />
            Attendance Analytics
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Department-level attendance overview · last {days} days
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── KPI Strip ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          icon={Activity} label="Overall Attendance"
          color="bg-indigo-100 text-indigo-600"
          value={loading ? <Skeleton /> : `${ov?.overallAvgAttendance ?? 0}%`}
          sub={`${ov?.totalSessions ?? 0} sessions conducted`}
        />
        <KpiCard
          icon={Users} label="Active Students"
          color="bg-sky-100 text-sky-600"
          value={loading ? <Skeleton /> : (ov?.activeStudents ?? 0).toLocaleString()}
          sub={`of ${(ov?.totalStudents ?? 0).toLocaleString()} enrolled`}
        />
        <KpiCard
          icon={UserX} label="At-Risk Students"
          color="bg-amber-100 text-amber-600"
          value={loading ? <Skeleton /> : `${ov?.atRiskPct ?? 0}%`}
          sub={`${(ov?.atRiskCount ?? 0).toLocaleString()} below 60%`}
        />
        <KpiCard
          icon={GraduationCap} label="Lecturers Active"
          color="bg-violet-100 text-violet-600"
          value={loading ? <Skeleton /> : (ov?.totalLecturers ?? 0).toLocaleString()}
          sub={`in last ${days} days`}
        />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {(["overview", "lecturers", "students", "units", "courses", "trends"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${
              tab === t
                ? "bg-white text-indigo-600 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          Tab: Overview
      ══════════════════════════════════════════════════════════════════ */}
      {tab === "overview" && (
        <div className="grid md:grid-cols-2 gap-6">

          {/* Year breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-indigo-400" />
              Attendance by Year of Study
            </h2>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-8 rounded bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (data?.students.byYear ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">No data available.</p>
            ) : (
              <div className="space-y-3">
                {(data?.students.byYear ?? []).map(yr => (
                  <div key={yr.year}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-gray-700">Year {yr.year}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-gray-400">{yr.totalStudents} students</span>
                        {yr.atRiskPct > 0 && (
                          <span className="text-amber-600">{yr.atRiskPct}% at-risk</span>
                        )}
                        <span className={`font-semibold ${pctColor(yr.avgAttendance)}`}>
                          {yr.avgAttendance}%
                        </span>
                      </div>
                    </div>
                    <Bar pct={yr.avgAttendance} color={barColor(yr.avgAttendance)} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Critical students */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              Critical Students — Below 40%
            </h2>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-8 rounded bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (data?.students.critical ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                No critical students — great work!
              </p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {(data?.students.critical ?? []).map(s => (
                  <div
                    key={s.studentId}
                    onClick={() => setSelectedStudent(s)}
                    className="flex items-center justify-between rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2 cursor-pointer hover:bg-rose-100/60 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">{s.studentName}</p>
                      <p className="text-xs text-gray-400">{s.admissionNumber} · Year {s.year}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-sm font-bold text-rose-600">{s.overallAttendance}%</span>
                      <ChevronRight className="h-4 w-4 text-rose-400" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Best & Worst Units */}
          {!loading && (() => {
            const eligible = [...(data?.units ?? [])].filter(u => !u.lowActivity && u.enrolled >= 3 && u.sessionsHeld >= 2);
            if (eligible.length === 0) return null;
            // API returns ascending — worst first, slice best from end
            const worst = eligible.slice(0, Math.min(5, eligible.length));
            const best  = [...eligible].reverse().slice(0, Math.min(5, eligible.length));
            const UnitPill = ({ u, variant }: { u: typeof eligible[0]; variant: "worst" | "best" }) => (
              <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                variant === "worst"
                  ? "border-rose-100 bg-white"
                  : "border-emerald-100 bg-white"
              }`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-mono font-bold text-gray-800">{u.unitCode}</span>
                    {u.atRiskPct > 40 && variant === "worst" && (
                      <span className="text-[10px] rounded-full bg-rose-100 text-rose-600 px-1.5 py-0.5 font-medium">
                        {u.atRiskCount} at-risk
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate">{u.unitTitle}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${variant === "worst"
                          ? u.avgAttendance >= 40 ? "bg-amber-400" : "bg-rose-500"
                          : "bg-emerald-500"}`}
                        style={{ width: `${u.avgAttendance}%` }}
                      />
                    </div>
                    <span className={`text-xs font-bold shrink-0 tabular-nums ${pctColor(u.avgAttendance)}`}>
                      {u.avgAttendance}%
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">{u.enrolled} enrolled · {u.sessionsHeld} sessions</p>
                </div>
              </div>
            );
            return (
              <div className="md:col-span-2 grid sm:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-5">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-rose-500" />
                    Worst Performing Units
                    <span className="ml-auto text-[10px] text-gray-400 font-normal">by avg student attendance</span>
                  </h2>
                  <div className="space-y-2">
                    {worst.map(u => <UnitPill key={u.unitId} u={u} variant="worst" />)}
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    Best Performing Units
                    <span className="ml-auto text-[10px] text-gray-400 font-normal">by avg student attendance</span>
                  </h2>
                  <div className="space-y-2">
                    {best.map(u => <UnitPill key={u.unitId} u={u} variant="best" />)}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Risk alert banner */}
          {!loading && (ov?.atRiskCount ?? 0) > 0 && (
            <div className="md:col-span-2 bg-amber-50 border border-amber-200 rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-amber-800">
                    {ov?.atRiskCount} students ({ov?.atRiskPct}%) are below 60% attendance in this department
                  </p>
                  {(ov?.criticalCount ?? 0) > 0 && (
                    <p className="text-sm text-rose-700 flex items-center gap-1.5">
                      <AlertCircle className="h-4 w-4" />
                      {ov?.criticalCount} students ({ov?.criticalPct}%) are below 40% — require immediate intervention
                    </p>
                  )}
                  <p className="text-xs text-amber-600 mt-1">
                    Switch to the Students tab to view individual at-risk students.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Tab: Lecturers
      ══════════════════════════════════════════════════════════════════ */}
      {tab === "lecturers" && (
        <div className="space-y-6">

          {/* Performance table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-indigo-400" />
                Lecturer Performance — This Department
              </h2>
            </div>
            {loading ? (
              <div className="p-6 space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-10 rounded bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (data?.lecturers ?? []).length === 0 ? (
              <div className="p-6 text-sm text-gray-400">No lecturer data in this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Lecturer</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Sessions</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Units</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Hrs/Wk</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg Class</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(data?.lecturers ?? []).map(lec => (
                      <Fragment key={lec.lecturerId}>
                      <tr
                        className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                        onClick={() => setExpandedLecturer(expandedLecturer === lec.lecturerId ? null : lec.lecturerId)}
                      >
                        <td className="px-6 py-3">
                          <p className="font-medium text-gray-800">{lec.lecturerName}</p>
                          <div className="flex flex-wrap items-center gap-1 mt-0.5">
                            {lec.catSessions > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                <ClipboardList className="h-2.5 w-2.5" />{lec.catSessions} CAT
                              </span>
                            )}
                            {lec.ratSessions > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
                                <Layers className="h-2.5 w-2.5" />{lec.ratSessions} RAT
                              </span>
                            )}
                            {lec.labSessions > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">
                                <FlaskConical className="h-2.5 w-2.5" />{lec.labSessions} LAB
                              </span>
                            )}
                            {lec.assignmentsPosted > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                <FileText className="h-2.5 w-2.5" />{lec.assignmentsPosted} Assign.
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{lec.totalSessions}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{lec.unitCount}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{lec.hoursPerWeek}h</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className={`font-semibold ${pctColor(lec.avgClassAttendance)}`}>
                              {lec.avgClassAttendance > 0 ? `${lec.avgClassAttendance}%` : "—"}
                            </span>
                            <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform shrink-0 ${expandedLecturer === lec.lecturerId ? "rotate-180" : ""}`} />
                          </div>
                        </td>
                      </tr>
                      {expandedLecturer === lec.lecturerId && lec.units && lec.units.length > 0 && (
                        <tr className="bg-gray-50/80">
                          <td colSpan={5} className="px-6 py-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Per-Unit Breakdown</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                              {lec.units.map(u => (
                                <div key={u.unitCode} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-xs font-mono font-bold text-gray-800">{u.unitCode}</p>
                                      <p className="text-xs text-gray-400 truncate">{u.unitTitle}</p>
                                    </div>
                                    <span className={`shrink-0 text-sm font-bold tabular-nums ${pctColor(u.avgClassAttendance)}`}>{u.avgClassAttendance}%</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                    <div className={`h-full rounded-full ${barColor(u.avgClassAttendance)}`} style={{ width: `${u.avgClassAttendance}%` }} />
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {u.lecSessions > 0 && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                                        <Calendar className="h-2.5 w-2.5" />{u.lecSessions} LEC
                                      </span>
                                    )}
                                    {u.catSessions > 0 && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                        <ClipboardList className="h-2.5 w-2.5" />{u.catSessions} CAT
                                      </span>
                                    )}
                                    {u.ratSessions > 0 && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full bg-cyan-50 border border-cyan-200 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
                                        <Layers className="h-2.5 w-2.5" />{u.ratSessions} RAT
                                      </span>
                                    )}
                                    {u.labSessions > 0 && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full bg-teal-50 border border-teal-200 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">
                                        <FlaskConical className="h-2.5 w-2.5" />{u.labSessions} LAB
                                      </span>
                                    )}
                                    {u.gdSessions > 0 && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                                        <Users className="h-2.5 w-2.5" />{u.gdSessions} GD
                                      </span>
                                    )}
                                    {u.assignmentsPosted > 0 && (
                                      <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                        <FileText className="h-2.5 w-2.5" />{u.assignmentsPosted} Assign.
                                      </span>
                                    )}
                                    {u.lecSessions === 0 && u.catSessions === 0 && u.ratSessions === 0 && u.labSessions === 0 && u.gdSessions === 0 && u.assignmentsPosted === 0 && (
                                      <span className="text-[10px] text-gray-400">{u.totalSessions} session{u.totalSessions !== 1 ? "s" : ""}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

{!loading && (data?.lecturers ?? []).length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-4">Avg Class Attendance Ranking</h2>
              <div className="space-y-3">
                {[...(data?.lecturers ?? [])]
                  .sort((a, b) => b.avgClassAttendance - a.avgClassAttendance)
                  .map(lec => (
                    <div key={lec.lecturerId} className="flex items-center gap-3">
                      <div className="w-28 shrink-0 text-right text-xs text-gray-500 truncate">
                        {lec.lecturerName.split(" ").slice(0, 2).join(" ")}
                      </div>
                      <Bar pct={lec.avgClassAttendance} color={barColor(lec.avgClassAttendance)} />
                      <div className={`w-10 shrink-0 text-xs font-semibold text-right ${pctColor(lec.avgClassAttendance)}`}>
                        {lec.avgClassAttendance}%
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Tab: Students
      ══════════════════════════════════════════════════════════════════ */}
      {tab === "students" && (
        <div className="space-y-6">

          {/* Find any student */}
          {admin?.departmentId && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Search className="h-3.5 w-3.5" />
                Find any student
              </p>
              <StudentSearchWidget
                departmentId={admin.departmentId}
                onSelect={s => { setSearchDrawerStudent(s); setSelectedStudent(null); }}
              />
            </div>
          )}

          {/* Risk cohort cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              {
                label: "Normal (≥75%)",
                count: (ov?.activeStudents ?? 0) - (ov?.atRiskCount ?? 0),
                colorText: "text-emerald-600",
                colorBg: "bg-emerald-50 border-emerald-200",
              },
              {
                label: "Watch (60–74%)",
                count: Math.max(0, (ov?.atRiskCount ?? 0) - (ov?.criticalCount ?? 0)),
                colorText: "text-amber-600",
                colorBg: "bg-amber-50 border-amber-200",
              },
              {
                label: "At-Risk (<60%)",
                count: ov?.atRiskCount ?? 0,
                colorText: "text-orange-600",
                colorBg: "bg-orange-50 border-orange-200",
              },
              {
                label: "Critical (<40%)",
                count: ov?.criticalCount ?? 0,
                colorText: "text-rose-700",
                colorBg: "bg-rose-50 border-rose-200",
              },
            ].map(c => (
              <div key={c.label} className={`rounded-2xl border p-5 ${c.colorBg}`}>
                <p className="text-xs text-gray-500 font-medium mb-1">{c.label}</p>
                <p className={`text-2xl font-bold ${c.colorText}`}>
                  {loading ? <Skeleton h="h-7" /> : c.count.toLocaleString()}
                </p>
              </div>
            ))}
          </div>

          {/* At-risk % by year */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-rose-400" />
              At-Risk % by Year of Study
            </h2>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-8 rounded bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (data?.students.byYear ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">No data available.</p>
            ) : (
              <div className="space-y-3">
                {(data?.students.byYear ?? []).map(yr => (
                  <div key={yr.year} className="flex items-center gap-4">
                    <div className="w-16 text-xs text-gray-500 font-medium shrink-0">Year {yr.year}</div>
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">
                          {yr.totalStudents} students · avg {yr.avgAttendance}%
                        </span>
                        <span className={`font-semibold ${yr.atRiskPct > 20 ? "text-rose-600" : "text-amber-600"}`}>
                          {yr.atRiskPct}% at-risk
                        </span>
                      </div>
                      <Bar
                        pct={yr.atRiskPct}
                        color={yr.atRiskPct > 20 ? "bg-rose-500" : "bg-amber-400"}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* At-risk student list */}
          {!loading && (data?.students.atRisk ?? []).length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-amber-500" />
                  At-Risk Students — Below 60% Attendance
                </h2>
                <span className="text-xs text-gray-400">
                  {data?.students.atRisk.length} students
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Student</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Admission No.</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Year</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Attendance</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Risk</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(data?.students.atRisk ?? []).map(s => (
                      <tr
                        key={s.studentId}
                        onClick={() => setSelectedStudent(s)}
                        className={`cursor-pointer hover:bg-indigo-50/30 transition-colors ${s.riskLevel === "critical" ? "bg-rose-50/20" : ""}`}
                      >
                        <td className="px-6 py-3 font-medium text-gray-800 max-w-[180px] truncate">
                          {s.studentName}
                        </td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{s.admissionNumber}</td>
                        <td className="px-4 py-3 text-right text-gray-600">Yr {s.year}</td>
                        <td className="px-4 py-3 text-right font-bold">
                          <span className={pctColor(s.overallAttendance)}>{s.overallAttendance}%</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskBadge(s.riskLevel)}`}>
                            {s.riskLevel.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Tab: Units
      ══════════════════════════════════════════════════════════════════ */}
      {tab === "units" && (
        <div className="space-y-6">

          {/* Low-activity alert */}
          {!loading && (data?.units ?? []).some(u => u.lowActivity) && (
            <div className="flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {(data?.units ?? []).filter(u => u.lowActivity).length} unit(s) have fewer than 2 sessions recorded in this period.
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Attendance percentages for these units may not be meaningful. They are flagged below.
                </p>
              </div>
            </div>
          )}

          {/* Unit table */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-indigo-400" />
                Unit Attendance Breakdown
              </h2>
            </div>
            {loading ? (
              <div className="p-6 space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-10 rounded bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (data?.units ?? []).length === 0 ? (
              <div className="p-6 text-sm text-gray-400">No unit data in this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Unit</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Lecturer</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Sessions</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Enrolled</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">At-Risk</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg Att.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(data?.units ?? []).map(u => (
                      <tr key={u.unitId} className={`hover:bg-gray-50/50 transition-colors ${u.lowActivity ? "bg-amber-50/30" : ""}`}>
                        <td className="px-6 py-3">
                          <p className="font-medium text-gray-800 leading-tight">{u.unitCode}</p>
                          <p className="text-xs text-gray-400 truncate max-w-[160px]">{u.unitTitle}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-[130px] truncate">{u.lecturerName}</td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {u.sessionsHeld}
                          {u.lowActivity && (
                            <span className="ml-1 text-amber-500 text-xs">⚠</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{u.enrolled}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs font-medium ${u.atRiskPct > 20 ? "text-rose-600" : "text-amber-600"}`}>
                            {u.atRiskCount} ({u.atRiskPct}%)
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${barColor(u.avgAttendance)}`}
                                style={{ width: `${u.avgAttendance}%` }}
                              />
                            </div>
                            <span className={`font-semibold text-xs ${pctColor(u.avgAttendance)}`}>
                              {u.avgAttendance}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Tab: Courses
      ══════════════════════════════════════════════════════════════════ */}
      {tab === "courses" && (
        <div className="space-y-6">

          {/* Course KPI strip */}
          {!loading && data && (() => {
            const courses = data.students.byCourse ?? [];
            const totalCourses  = courses.length;
            const avgAtt        = courses.length > 0
              ? Math.round(courses.reduce((s, c) => s + c.avgAttendance, 0) / courses.length)
              : 0;
            const atRiskCourses = courses.filter(c => c.avgAttendance < 60).length;
            const totalStudents = courses.reduce((s, c) => s + c.activeStudents, 0);
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Courses",          value: totalCourses,  icon: BookOpen,      color: "bg-indigo-100 text-indigo-600" },
                  { label: "Students (active)", value: totalStudents,  icon: Users,         color: "bg-sky-100 text-sky-600" },
                  { label: "Dept Avg Att.",     value: `${avgAtt}%`,  icon: Activity,      color: "bg-emerald-100 text-emerald-600" },
                  { label: "Courses at-risk",   value: atRiskCourses, icon: AlertTriangle, color: "bg-amber-100 text-amber-600" },
                ].map(c => (
                  <div key={c.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${c.color}`}>
                      <c.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{c.label}</p>
                      <p className="text-2xl font-bold text-gray-800 leading-tight mt-0.5">{c.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {loading && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-2">
                  <div className="h-5 w-24 rounded bg-gray-100 animate-pulse" />
                  <div className="h-8 w-16 rounded bg-gray-100 animate-pulse" />
                </div>
              ))}
            </div>
          )}

          {/* Course comparison bar chart */}
          {!loading && (data?.students.byCourse ?? []).length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-5 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-indigo-400" />
                Course Attendance Comparison
              </h2>
              <div className="space-y-3">
                {[...(data?.students.byCourse ?? [])]
                  .sort((a, b) => b.avgAttendance - a.avgAttendance)
                  .map(c => (
                    <div key={c.courseId} className="flex items-center gap-3">
                      <div className="w-36 shrink-0 text-right">
                        <p className="text-xs font-semibold text-gray-700 truncate">{c.courseCode}</p>
                        <p className="text-[10px] text-gray-400 truncate">{c.activeStudents} students</p>
                      </div>
                      <Bar pct={c.avgAttendance} color={barColor(c.avgAttendance)} />
                      <div className="w-12 shrink-0 text-right">
                        <span className={`text-sm font-bold ${pctColor(c.avgAttendance)}`}>{c.avgAttendance}%</span>
                      </div>
                      {c.atRiskCount > 0 && (
                        <span className="shrink-0 text-xs text-rose-600 font-medium">{c.atRiskCount} at-risk</span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Per-course expandable cards */}
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />
              ))}
            </div>
          ) : (data?.students.byCourse ?? []).length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
              <BookOpen className="h-8 w-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No course data available for this period.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(data?.students.byCourse ?? []).map(course => (
                <div key={course.courseId} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${
                  course.avgAttendance < 40 ? "border-rose-200" :
                  course.avgAttendance < 60 ? "border-amber-200" :
                  course.avgAttendance < 75 ? "border-yellow-200" :
                  "border-gray-100"
                }`}>
                  {/* Course header row */}
                  <button
                    className="w-full flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors text-left"
                    onClick={() => setExpandedCourse(expandedCourse === course.courseId ? null : course.courseId)}
                  >
                    {/* Course identity */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-gray-800">{course.courseCode}</span>
                        <span className="text-sm text-gray-500">—</span>
                        <span className="text-sm text-gray-700 truncate">{course.courseName}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-xs text-gray-400">{course.activeStudents} active · {course.totalStudents} total</span>
                        {course.atRiskCount > 0 && (
                          <span className="text-xs text-amber-600 font-medium">{course.atRiskCount} at-risk</span>
                        )}
                        {course.criticalCount > 0 && (
                          <span className="text-xs text-rose-600 font-medium">{course.criticalCount} critical</span>
                        )}
                        {course.velocityDelta !== 0 && (
                          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${course.velocityDelta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                            {course.velocityDelta > 0
                              ? <ArrowUpRight className="h-3 w-3" />
                              : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(course.velocityDelta)}pp trend
                          </span>
                        )}
                        {course.velocityDelta === 0 && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-gray-400">
                            <Minus className="h-3 w-3" /> stable
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Attendance bar */}
                    <div className="hidden sm:flex items-center gap-2 w-40 shrink-0">
                      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full rounded-full ${barColor(course.avgAttendance)}`} style={{ width: `${course.avgAttendance}%` }} />
                      </div>
                      <span className={`text-sm font-bold tabular-nums shrink-0 ${pctColor(course.avgAttendance)}`}>{course.avgAttendance}%</span>
                    </div>

                    <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${expandedCourse === course.courseId ? "rotate-180" : ""}`} />
                  </button>

                  {/* Expanded details */}
                  {expandedCourse === course.courseId && (
                    <div className="border-t border-gray-100 px-6 py-5 space-y-5 bg-gray-50/60">

                      {/* Mobile attendance bar */}
                      <div className="sm:hidden flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                          <div className={`h-full rounded-full ${barColor(course.avgAttendance)}`} style={{ width: `${course.avgAttendance}%` }} />
                        </div>
                        <span className={`text-sm font-bold tabular-nums shrink-0 ${pctColor(course.avgAttendance)}`}>{course.avgAttendance}%</span>
                      </div>

                      {/* Risk cohort pills */}
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: "Active Students",  value: course.activeStudents,  color: "bg-indigo-100 text-indigo-700" },
                          { label: "At-Risk (<60%)",   value: course.atRiskCount,     color: "bg-amber-100 text-amber-700"   },
                          { label: "Critical (<40%)",  value: course.criticalCount,   color: "bg-rose-100 text-rose-700"     },
                          { label: "At-Risk %",        value: `${course.atRiskPct}%`, color: course.atRiskPct > 20 ? "bg-rose-50 text-rose-600" : "bg-gray-100 text-gray-600" },
                        ].map(p => (
                          <div key={p.label} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${p.color}`}>
                            <span className="font-bold">{p.value}</span>
                            <span className="opacity-70">{p.label}</span>
                          </div>
                        ))}
                      </div>

                      {/* Year breakdown within course */}
                      {course.yearBreakdown.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Attendance by Year</p>
                          <div className="space-y-2">
                            {course.yearBreakdown.map(yr => (
                              <div key={yr.year} className="flex items-center gap-3">
                                <div className="w-16 text-xs text-gray-500 font-medium shrink-0">Year {yr.year}</div>
                                <Bar pct={yr.avgAttendance} color={barColor(yr.avgAttendance)} />
                                <div className="w-28 text-xs text-right shrink-0">
                                  <span className={`font-semibold ${pctColor(yr.avgAttendance)}`}>{yr.avgAttendance}%</span>
                                  <span className="text-gray-400 ml-1">({yr.totalStudents} students)</span>
                                </div>
                                {yr.atRiskCount > 0 && (
                                  <span className="text-xs text-rose-500 shrink-0">{yr.atRiskCount} at-risk</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Top at-risk students in this course */}
                      {course.topAtRisk.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                            Top At-Risk Students
                          </p>
                          <div className="grid sm:grid-cols-2 gap-2">
                            {course.topAtRisk.map(s => (
                              <div key={s.studentId} className="flex items-center gap-3 rounded-xl border border-rose-100 bg-white px-3 py-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-gray-800 truncate">{s.studentName}</p>
                                  <p className="text-xs text-gray-400">{s.admissionNumber} · Year {s.year}</p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <span className={`text-sm font-bold tabular-nums ${pctColor(s.overallAttendance)}`}>{s.overallAttendance}%</span>
                                  <p className={`text-[10px] font-medium mt-0.5 ${riskBadge(s.riskLevel)}`}>{s.riskLevel.toUpperCase()}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Tab: Trends
      ══════════════════════════════════════════════════════════════════ */}
      {tab === "trends" && (
        <div className="space-y-6">

          {/* Attendance distribution */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-400" />
              Attendance Distribution — Student Count per Band
            </h2>
            {loading ? (
              <div className="flex items-end gap-2 h-32">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="flex-1 rounded-t bg-gray-100 animate-pulse" style={{ height: `${30 + i * 7}%` }} />
                ))}
              </div>
            ) : (
              (() => {
                const dist = data?.distribution ?? [];
                const max  = Math.max(1, ...dist.map(b => b.count));
                return (
                  <div className="space-y-1">
                    {dist.map((b, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-20 text-xs text-gray-500 text-right shrink-0">{b.range}</div>
                        <div className="flex-1 h-5 rounded bg-gray-50 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(b.count / max) * 100}%` }}
                            transition={{ duration: 0.6, delay: i * 0.04, ease: "easeOut" }}
                            className={`h-full rounded ${i <= 3 ? "bg-rose-400" : i <= 5 ? "bg-amber-400" : i <= 7 ? "bg-yellow-300" : "bg-emerald-400"}`}
                          />
                        </div>
                        <div className="w-8 text-xs font-semibold text-gray-700 shrink-0">{b.count}</div>
                      </div>
                    ))}
                  </div>
                );
              })()
            )}
          </div>

          {/* Weekly trend */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-400" />
              Weekly Session Activity
            </h2>
            {loading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-8 rounded bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (data?.weeklyTrend ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">No weekly data for this period.</p>
            ) : (
              (() => {
                const trend = data?.weeklyTrend ?? [];
                const maxSess = Math.max(1, ...trend.map(w => w.sessions));
                return (
                  <div className="space-y-2">
                    {trend.map(w => (
                      <div key={w.week} className="flex items-center gap-3">
                        <div className="w-20 text-xs text-gray-500 shrink-0">{w.week}</div>
                        <div className="flex-1 h-5 rounded bg-gray-50 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${(w.sessions / maxSess) * 100}%` }}
                            transition={{ duration: 0.6, ease: "easeOut" }}
                            className="h-full rounded bg-indigo-400"
                          />
                        </div>
                        <div className="w-24 text-xs text-gray-600 shrink-0">
                          {w.sessions} sess · {w.avgPresent} avg
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()
            )}
          </div>

          {/* Day-of-week heatmap */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-indigo-400" />
              Attendance by Day of Week
            </h2>
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-8 rounded bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : (data?.dowAbsenteeism ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">No day-of-week data available.</p>
            ) : (
              <div className="space-y-3">
                {(data?.dowAbsenteeism ?? []).map(d => {
                  const pct = d.avgAttendancePct ?? 0;
                  return (
                    <div key={d.day} className="flex items-center gap-3">
                      <div className="w-24 text-xs font-medium text-gray-700 shrink-0">{d.day}</div>
                      <Bar pct={pct} color={barColor(pct)} />
                      <div className="w-24 text-xs text-right shrink-0">
                        {d.avgAttendancePct !== null ? (
                          <span className={`font-semibold ${pctColor(pct)}`}>{pct}%</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                        <span className="text-gray-400 ml-1">({d.sessions} sess)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}

      <AnimatePresence>
        {activeDrawerStudent && (
          <StudentDrawer
            student={activeDrawerStudent}
            unitTitleMap={data?.unitTitleMap ?? {}}
            onClose={() => { setSelectedStudent(null); setSearchDrawerStudent(null); }}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
