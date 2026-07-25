"use client";
import { useEffect, useState, useCallback, useMemo, Fragment } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users, GraduationCap, BookOpen, TrendingUp,
  AlertTriangle, CheckCircle2, Search, ChevronDown,
  BarChart2, Calendar, Clock,
  Activity, ShieldAlert, Target, RefreshCw,
  FileText, ClipboardList, FlaskConical, Layers,
  TrendingDown, Zap, Ghost, Cpu, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { useDepartmentAdmin } from "../../context";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface Overview {
  totalStudents: number;
  activeStudents: number;
  totalLecturers: number;
  totalSessions: number;
  overallAvgAttendance: number;
  atRiskCount: number;
  atRiskPct: number;
  criticalCount: number;
  criticalPct: number;
  lookbackDays: number;
}

interface LecturerUnitStat {
  unitCode: string;
  unitTitle: string;
  totalSessions: number;
  lecSessions: number;
  catSessions: number;
  ratSessions: number;
  labSessions: number;
  gdSessions: number;
  semSessions: number;
  assignmentsPosted: number;
  avgClassAttendance: number;
}

interface LecturerStat {
  lecturerId: string;
  lecturerName: string;
  department: string;
  totalSessions: number;
  hoursPerWeek: number;
  unitCount: number;
  avgClassAttendance: number;
  totalRecordsCreated: number;
  catSessions: number;
  ratSessions: number;
  labSessions: number;
  assignmentsPosted: number;
  units?: LecturerUnitStat[];
}

interface StudentAtRisk {
  studentId: string;
  studentName: string;
  admissionNumber: string;
  year: number;
  course: string;
  overallAttendance: number;
  riskLevel: "watch" | "warning" | "critical";
  enrolledUnitCount: number;
  totalSessions: number;
  totalAttended: number;
  perCourseAttendance?: Record<string, { sessions: number; attended: number }>;
}

interface YearBreakdown {
  year: number;
  totalStudents: number;
  avgAttendance: number;
  atRiskCount: number;
  atRiskPct: number;
}

interface ApiUnitStat {
  unitId: string;
  unitCode: string;
  unitTitle: string;
  department: string;
  sessionsHeld: number;
  enrolled: number;
  avgAttendance: number;
  atRiskCount: number;
  atRiskPct: number;
  lecturerName: string;
  lowActivity: boolean;
  lecSessions: number;
  catSessions: number;
  ratSessions: number;
  labSessions: number;
  gdSessions: number;
  semSessions: number;
  assignmentsPosted: number;
}

interface StudentPrediction {
  studentId: string;
  studentName: string;
  admissionNumber: string;
  year: number;
  overallAttendance: number;
  riskLevel: string;
  sessionsNeededGlobal: number;
  velocityTrend: "improving" | "declining" | "stable";
  velocityDelta: number;
  maxConsecAbsences: number;
  worstStreakUnit: string;
  projectedEndRate: number;
  unitsAtThreshold: number;
}

interface LecturerRegularity {
  lecturerId: string;
  lecturerName: string;
  weeklySessionAvg: number;
  regularityScore: number;
  weeksActive: number;
}

interface GhostUnit {
  unitCode: string;
  unitTitle: string;
  enrolled: number;
  sessionsHeld: number;
  avgAttendance: number;
  lecturerName: string;
}

interface WeeklyTrendPoint { week: string; sessions: number; avgPresent: number; }
interface DowPoint { day: string; sessions: number; avgAttendancePct: number | null; }
interface DistributionBucket { range: string; count: number; }

interface AnalyticsData {
  overview: Overview;
  lecturers: LecturerStat[];
  students: {
    byYear: YearBreakdown[];
    atRisk: StudentAtRisk[];
    critical: StudentAtRisk[];
    all?: StudentAtRisk[];
  };
  units?: ApiUnitStat[];
  distribution?: DistributionBucket[];
  weeklyTrend?: WeeklyTrendPoint[];
  dowAbsenteeism?: DowPoint[];
  predictive?: {
    thresholdProximity: StudentPrediction[];
    velocityDeclines: StudentPrediction[];
    consecutiveAlerts: StudentPrediction[];
    ghostEnrollmentUnits: GhostUnit[];
    lecturerRegularity: LecturerRegularity[];
    summary: {
      studentsNearThreshold: number;
      studentsVelocityDecline: number;
      studentsConsecAbsent: number;
      ghostEnrollmentUnitCount: number;
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function pct(n: number): string { return `${n}%`; }

function riskColor(level: string) {
  if (level === "critical") return "bg-rose-100 text-rose-700 border-rose-200";
  if (level === "warning")  return "bg-amber-100 text-amber-700 border-amber-200";
  if (level === "watch")    return "bg-yellow-50 text-yellow-700 border-yellow-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}
function riskBadge(level: string) {
  if (level === "critical") return "bg-rose-100 text-rose-700";
  if (level === "warning")  return "bg-amber-100 text-amber-700";
  if (level === "watch")    return "bg-yellow-100 text-yellow-700";
  return "bg-emerald-100 text-emerald-700";
}
function attendanceBg(rate: number) {
  if (rate >= 75) return "bg-emerald-500";
  if (rate >= 60) return "bg-yellow-400";
  if (rate >= 40) return "bg-amber-500";
  return "bg-rose-500";
}
function attendanceText(rate: number) {
  if (rate >= 75) return "text-emerald-600";
  if (rate >= 60) return "text-yellow-600";
  if (rate >= 40) return "text-amber-600";
  return "text-rose-600";
}

function AttendanceBar({ rate }: { rate: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${attendanceBg(rate)}`} style={{ width: `${Math.min(100, rate)}%` }} />
      </div>
      <span className={`text-xs font-semibold w-9 text-right tabular-nums ${attendanceText(rate)}`}>{pct(rate)}</span>
    </div>
  );
}

function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className ?? ""}`} style={style} />;
}

function MiniRing({ value, color, size = 56 }: { value: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
    </svg>
  );
}

function EmptyState({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10">
      <Icon className="h-8 w-8 text-gray-300" />
      <p className="text-sm text-gray-400">{text}</p>
    </div>
  );
}

type Tab = "overview" | "lecturers" | "students" | "units" | "insights";

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default function DeptAttendancePage() {
  const admin = useDepartmentAdmin();
  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<Tab>("overview");
  const [days, setDays]       = useState(30);
  const [search, setSearch]   = useState("");
  const [sortLec, setSortLec] = useState<keyof LecturerStat>("totalSessions");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [expandedLecturer, setExpandedLecturer] = useState<string | null>(null);
  const [studentView, setStudentView] = useState<"at-risk" | "all">("at-risk");

  const load = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    const analytics = await fetch(
      `/api/admin/attendance-analytics?institutionId=${admin.institutionId}&departmentId=${admin.departmentId}&days=${days}`,
      { credentials: "include" }
    ).then(r => r.ok ? r.json() : null);
    if (analytics) setData(analytics);
    setLoading(false);
  }, [admin?.institutionId, admin?.departmentId, days]);

  useEffect(() => { load(); }, [load]);

  const filteredLecturers = useMemo(() => {
    const q = search.toLowerCase();
    const list = (data?.lecturers ?? []).filter(l =>
      !q || l.lecturerName.toLowerCase().includes(q)
    );
    return [...list].sort((a, b) => {
      const av = a[sortLec] as number;
      const bv = b[sortLec] as number;
      return sortAsc ? av - bv : bv - av;
    });
  }, [data?.lecturers, search, sortLec, sortAsc]);

  const filteredAtRisk = useMemo(() => {
    const q = search.toLowerCase();
    return (data?.students.atRisk ?? []).filter(s =>
      !q || s.studentName.toLowerCase().includes(q) || s.admissionNumber.toLowerCase().includes(q)
    );
  }, [data?.students.atRisk, search]);

  const filteredAll = useMemo(() => {
    const q = search.toLowerCase();
    return (data?.students.all ?? []).filter(s =>
      !q || s.studentName.toLowerCase().includes(q) || s.admissionNumber.toLowerCase().includes(q)
    );
  }, [data?.students.all, search]);

  const filteredUnits = useMemo(() => {
    const q = search.toLowerCase();
    return (data?.units ?? []).filter(u =>
      !q || u.unitCode.toLowerCase().includes(q) || u.unitTitle.toLowerCase().includes(q)
    ).sort((a, b) => a.avgAttendance - b.avgAttendance);
  }, [data?.units, search]);

  const overview         = data?.overview;
  const yearBreakdown    = data?.students.byYear ?? [];
  const atRisk           = filteredAtRisk;
  const displayedStudents = studentView === "all" ? filteredAll : atRisk;
  const analyticsUnits   = data?.units ?? [];

  function toggleSort(col: keyof LecturerStat) {
    if (sortLec === col) setSortAsc(v => !v);
    else { setSortLec(col); setSortAsc(false); }
  }

  const SortIcon = ({ col }: { col: keyof LecturerStat }) =>
    sortLec === col
      ? sortAsc ? <ChevronDown className="h-3 w-3 rotate-180" /> : <ChevronDown className="h-3 w-3" />
      : <ChevronDown className="h-3 w-3 opacity-30" />;

  return (
    <div className="min-h-full space-y-5 pb-10">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="h-5 w-5 text-indigo-600" />
            Attendance Analytics
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">{admin?.departmentName}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── KPI cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))
        ) : ([
          {
            label: "Avg Attendance", value: pct(overview?.overallAvgAttendance ?? 0),
            sub: `${overview?.activeStudents ?? 0} active students`,
            icon: Target, color: "text-indigo-600", bg: "bg-indigo-50",
            ring: overview?.overallAvgAttendance ?? 0, ringColor: "#6366f1",
          },
          {
            label: "At Risk", value: String(overview?.atRiskCount ?? 0),
            sub: `${pct(overview?.atRiskPct ?? 0)} of cohort`,
            icon: ShieldAlert, color: "text-amber-600", bg: "bg-amber-50",
            ring: overview?.atRiskPct ?? 0, ringColor: "#f59e0b",
          },
          {
            label: "Sessions Conducted", value: String(overview?.totalSessions ?? 0),
            sub: `Last ${days} days`,
            icon: Calendar, color: "text-sky-600", bg: "bg-sky-50",
            ring: null as null, ringColor: "#0ea5e9",
          },
          {
            label: "Critical Alerts", value: String(overview?.criticalCount ?? 0),
            sub: "Below 40% attendance",
            icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-50",
            ring: overview?.criticalPct ?? 0, ringColor: "#f43f5e",
          },
        ] as const).map((card, i) => (
          <motion.div key={card.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="rounded-2xl border border-gray-200 bg-white p-4 flex items-center gap-3"
          >
            {card.ring !== null ? (
              <div className="relative shrink-0">
                <MiniRing value={card.ring} color={card.ringColor} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <card.icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </div>
            ) : (
              <div className={`shrink-0 flex h-12 w-12 items-center justify-center rounded-xl ${card.bg}`}>
                <card.icon className={`h-5 w-5 ${card.color}`} />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs text-gray-400 font-medium">{card.label}</p>
              <p className={`text-2xl font-bold ${card.color} tabular-nums`}>{card.value}</p>
              <p className="text-xs text-gray-400 truncate">{card.sub}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 w-fit">
        {([
          { key: "overview",  label: "Overview",  icon: BarChart2 },
          { key: "lecturers", label: "Lecturers", icon: GraduationCap },
          { key: "students",  label: "Students",  icon: Users },
          { key: "units",     label: "Units",     icon: BookOpen },
          { key: "insights",  label: "Insights",  icon: Cpu },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => { setTab(key); setSearch(""); }}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
              tab === key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {/* ── Search bar ───────────────────────────────────────────────── */}
      {tab !== "overview" && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tab === "lecturers" ? "Search lecturer…" : tab === "students" ? "Search student or admission no…" : "Search unit…"}
            className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
        </div>
      )}

      <AnimatePresence mode="wait">

        {/* ════════════════════════ OVERVIEW TAB ════════════════════════ */}
        {tab === "overview" && (
          <motion.div key="overview" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-4"
          >
            {/* Attendance by year */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
                  <TrendingUp className="h-4 w-4 text-indigo-600" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Attendance by Year</h2>
                  <p className="text-xs text-gray-400">Average per academic year</p>
                </div>
              </div>
              {loading ? (
                <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : yearBreakdown.length === 0 ? (
                <EmptyState icon={Calendar} text="No year-group data yet" />
              ) : (
                <div className="space-y-3">
                  {yearBreakdown.map(y => (
                    <div key={y.year} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-gray-700">Year {y.year}</span>
                        <span className="text-gray-400">{y.totalStudents} students · {y.atRiskCount} at risk</span>
                      </div>
                      <AttendanceBar rate={y.avgAttendance} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Critical students */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50">
                  <AlertTriangle className="h-4 w-4 text-rose-600" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Critical Alerts</h2>
                  <p className="text-xs text-gray-400">Students below 40% attendance</p>
                </div>
              </div>
              {loading ? (
                <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : (data?.students.critical ?? []).length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                  <p className="text-sm text-gray-400">No critical students — great work!</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {(data?.students.critical ?? []).slice(0, 20).map(s => (
                    <div key={s.studentId} className="flex items-center gap-3 rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{s.studentName}</p>
                        <p className="text-xs text-gray-400">{s.admissionNumber} · Year {s.year}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-rose-600">{pct(s.overallAttendance)}</p>
                        <p className="text-xs text-gray-400">{s.totalAttended}/{s.totalSessions}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Unit health heatmap */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50">
                  <BookOpen className="h-4 w-4 text-sky-600" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Unit Attendance Health</h2>
                  <p className="text-xs text-gray-400">All units ranked from lowest to highest</p>
                </div>
              </div>
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : analyticsUnits.length === 0 ? (
                <EmptyState icon={BookOpen} text="No unit attendance data yet" />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {[...analyticsUnits].sort((a, b) => a.avgAttendance - b.avgAttendance).map(u => (
                    <div key={u.unitCode} className={`rounded-xl border px-3 py-2.5 ${
                      u.avgAttendance >= 75 ? "border-emerald-200 bg-emerald-50" :
                      u.avgAttendance >= 60 ? "border-yellow-200 bg-yellow-50" :
                      u.avgAttendance >= 40 ? "border-amber-200 bg-amber-50" :
                      "border-rose-200 bg-rose-50"
                    }`}>
                      <p className="text-xs font-mono font-semibold text-gray-700 truncate">{u.unitCode}</p>
                      <p className="text-xs text-gray-500 truncate mt-0.5">{u.unitTitle}</p>
                      <p className={`text-lg font-bold mt-1 tabular-nums ${attendanceText(u.avgAttendance)}`}>{pct(u.avgAttendance)}</p>
                      <p className="text-xs text-gray-400">{u.enrolled} enrolled</p>
                    </div>
                  ))}
                </div>
              )}
            </div>


          </motion.div>
        )}

        {/* ══════════════════════ LECTURERS TAB ═════════════════════════ */}
        {tab === "lecturers" && (
          <motion.div key="lecturers" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {!loading && data && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Active Lecturers",    value: String(data.lecturers.length),                                                   icon: GraduationCap, color: "text-indigo-600", bg: "bg-indigo-50" },
                  { label: "Total Sessions",       value: String(data.overview.totalSessions),                                             icon: Calendar,      color: "text-sky-600",    bg: "bg-sky-50" },
                  { label: "Best Avg Attendance",  value: data.lecturers.length > 0 ? pct(Math.max(...data.lecturers.map(l => l.avgClassAttendance))) : "—", icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
                  { label: "Needs Attention",      value: String(data.lecturers.filter(l => l.avgClassAttendance < 60).length),            icon: AlertTriangle, color: "text-amber-600",  bg: "bg-amber-50" },
                ].map(c => (
                  <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-4 flex items-center gap-3">
                    <div className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-xl ${c.bg}`}>
                      <c.icon className={`h-5 w-5 ${c.color}`} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">{c.label}</p>
                      <p className={`text-xl font-bold ${c.color} tabular-nums`}>{c.value}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Lecturer</th>
                      <th className="text-center px-3 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide cursor-pointer hover:text-gray-600 transition-colors" onClick={() => toggleSort("totalSessions")}>
                        <span className="inline-flex items-center justify-center gap-1">Sessions <SortIcon col="totalSessions" /></span>
                      </th>
                      <th className="text-center px-3 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide cursor-pointer hover:text-gray-600 transition-colors hidden md:table-cell" onClick={() => toggleSort("unitCount")}>
                        <span className="inline-flex items-center justify-center gap-1">Units <SortIcon col="unitCount" /></span>
                      </th>
                      <th className="text-center px-3 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide cursor-pointer hover:text-gray-600 transition-colors hidden lg:table-cell" onClick={() => toggleSort("hoursPerWeek")}>
                        <span className="inline-flex items-center justify-center gap-1">Hrs/Week <SortIcon col="hoursPerWeek" /></span>
                      </th>
                      <th className="px-5 py-3.5 text-xs font-semibold text-gray-400 uppercase tracking-wide cursor-pointer hover:text-gray-600 transition-colors" onClick={() => toggleSort("avgClassAttendance")}>
                        <span className="inline-flex items-center justify-center gap-1">Avg Class Attendance <SortIcon col="avgClassAttendance" /></span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      [...Array(6)].map((_, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          {[180, 60, 50, 60, 160].map((w, j) => (
                            <td key={j} className="px-5 py-3.5"><Skeleton style={{ width: w, height: 20 }} /></td>
                          ))}
                        </tr>
                      ))
                    ) : filteredLecturers.length === 0 ? (
                      <tr><td colSpan={5} className="py-14"><EmptyState icon={GraduationCap} text="No lecturers match your search" /></td></tr>
                    ) : filteredLecturers.map((l, i) => (
                      <Fragment key={l.lecturerId}>
                      <motion.tr initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                        className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setExpandedLecturer(expandedLecturer === l.lecturerId ? null : l.lecturerId)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold hover:bg-indigo-200 transition-colors"
                            >
                              {l.lecturerName.charAt(0).toUpperCase()}
                            </button>
                            <div>
                              <p className="font-medium text-gray-900">{l.lecturerName}</p>
                              <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                {l.catSessions > 0 && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                    <ClipboardList className="h-2.5 w-2.5" />{l.catSessions} CAT
                                  </span>
                                )}
                                {l.ratSessions > 0 && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-cyan-100 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700">
                                    <Layers className="h-2.5 w-2.5" />{l.ratSessions} RAT
                                  </span>
                                )}
                                {l.labSessions > 0 && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">
                                    <FlaskConical className="h-2.5 w-2.5" />{l.labSessions} LAB
                                  </span>
                                )}
                                {l.assignmentsPosted > 0 && (
                                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                    <FileText className="h-2.5 w-2.5" />{l.assignmentsPosted} Assign.
                                  </span>
                                )}
                                {l.catSessions === 0 && l.ratSessions === 0 && l.assignmentsPosted === 0 && (
                                  <span className="text-[10px] text-gray-400">{l.totalRecordsCreated} records</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-center">
                          <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] rounded-full bg-sky-100 text-sky-700 text-xs font-semibold px-2">
                            {l.totalSessions}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-center text-gray-600 hidden md:table-cell">{l.unitCount}</td>
                        <td className="px-3 py-3.5 text-center hidden lg:table-cell">
                          <div className="flex items-center justify-center gap-1 text-gray-600">
                            <Clock className="h-3 w-3 text-gray-400" />{l.hoursPerWeek}h
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1"><AttendanceBar rate={l.avgClassAttendance} /></div>
                            <ChevronDown
                              onClick={() => setExpandedLecturer(expandedLecturer === l.lecturerId ? null : l.lecturerId)}
                              className={`h-4 w-4 text-gray-400 cursor-pointer shrink-0 transition-transform ${expandedLecturer === l.lecturerId ? "rotate-180" : ""}`}
                            />
                          </div>
                        </td>
                      </motion.tr>
                      {/* Per-unit breakdown row */}
                      {expandedLecturer === l.lecturerId && l.units && l.units.length > 0 && (
                        <tr key={`${l.lecturerId}-expand`} className="bg-gray-50/70">
                          <td colSpan={5} className="px-5 py-4">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Per-Unit Breakdown</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                              {l.units.map(u => (
                                <div key={u.unitCode} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="text-xs font-mono font-bold text-gray-800 truncate">{u.unitCode}</p>
                                      <p className="text-xs text-gray-500 truncate">{u.unitTitle}</p>
                                    </div>
                                    <span className={`shrink-0 text-sm font-bold tabular-nums ${attendanceText(u.avgClassAttendance)}`}>{u.avgClassAttendance}%</span>
                                  </div>
                                  <AttendanceBar rate={u.avgClassAttendance} />
                                  <div className="flex flex-wrap gap-1 pt-1">
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
            </div>
          </motion.div>
        )}

        {/* ═══════════════════════ STUDENTS TAB ═════════════════════════ */}
        {tab === "students" && (
          <motion.div key="students" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {!loading && data && (
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Total Students",    value: data.overview.totalStudents,  color: "bg-gray-100 text-gray-700" },
                  { label: "Active (enrolled)", value: data.overview.activeStudents, color: "bg-indigo-100 text-indigo-700" },
                  { label: "At Risk (<75%)",    value: data.overview.atRiskCount,    color: "bg-amber-100 text-amber-700" },
                  { label: "Critical (<40%)",   value: data.overview.criticalCount,  color: "bg-rose-100 text-rose-700" },
                ].map(p => (
                  <div key={p.label} className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium ${p.color}`}>
                    <span className="font-bold">{p.value}</span>
                    <span className="opacity-70">{p.label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── Student view toggle ────────────────────────────────── */}
            <div className="flex gap-1 rounded-xl bg-gray-100 p-1 w-fit">
              {([
                { key: "at-risk" as const, label: "At Risk",      count: data?.overview.atRiskCount },
                { key: "all"     as const, label: "All Students", count: data?.overview.activeStudents },
              ]).map(v => (
                <button
                  key={v.key}
                  onClick={() => { setStudentView(v.key); setExpandedStudent(null); }}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                    studentView === v.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {v.label}
                  {!loading && v.count !== undefined && (
                    <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                      studentView === v.key ? "bg-indigo-100 text-indigo-700" : "bg-gray-200 text-gray-500"
                    }`}>{v.count}</span>
                  )}
                </button>
              ))}
            </div>

            {!loading && yearBreakdown.length > 0 && !search && studentView === "at-risk" && (
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-indigo-500" />
                  <h2 className="text-sm font-semibold text-gray-900">Cohort Breakdown by Year</h2>
                </div>
                <div className="divide-y divide-gray-100">
                  {yearBreakdown.map(y => (
                    <div key={y.year} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
                        <span className="text-sm font-bold text-indigo-600">Y{y.year}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium text-gray-900">Year {y.year}</p>
                          <p className="text-xs text-gray-400">{y.totalStudents} students</p>
                        </div>
                        <AttendanceBar rate={y.avgAttendance} />
                      </div>
                      <div className="shrink-0 text-right hidden sm:block">
                        <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          y.atRiskPct > 30 ? "bg-rose-100 text-rose-700" :
                          y.atRiskPct > 15 ? "bg-amber-100 text-amber-700" :
                          "bg-emerald-100 text-emerald-700"
                        }`}>
                          <ShieldAlert className="h-3 w-3" />
                          {y.atRiskCount} at-risk ({y.atRiskPct}%)
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {studentView === "all"
                    ? <Users className="h-4 w-4 text-indigo-500" />
                    : <AlertTriangle className="h-4 w-4 text-amber-500" />}
                  <h2 className="text-sm font-semibold text-gray-900">
                    {search ? "Search Results" : studentView === "all" ? "All Students" : "At-Risk Students"}
                  </h2>
                  {!loading && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      studentView === "all" ? "bg-indigo-100 text-indigo-700" : "bg-amber-100 text-amber-700"
                    }`}>{displayedStudents.length}</span>
                  )}
                </div>
                {!search && (
                  <p className="text-xs text-gray-400">
                    {studentView === "all"
                      ? "All enrolled students · click a row to expand"
                      : "Below 75% attendance · click a row to expand"}
                  </p>
                )}
              </div>
              <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
                {loading ? (
                  [...Array(6)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                      <Skeleton className="h-9 w-9 rounded-full" />
                      <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-28" /></div>
                      <Skeleton className="h-6 w-16" />
                    </div>
                  ))
                ) : displayedStudents.length === 0 ? (
                  <div className="py-14">
                    <EmptyState icon={CheckCircle2} text={search ? "No students match your search" : studentView === "all" ? "No enrolled students found" : "All students are on track — excellent!"} />
                  </div>
                ) : displayedStudents.slice(0, 300).map((s, i) => (
                  <motion.div key={s.studentId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.01 }}
                    className="cursor-pointer"
                    onClick={() => setExpandedStudent(expandedStudent === s.studentId ? null : s.studentId)}
                  >
                    <div className={`flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors ${expandedStudent === s.studentId ? "bg-gray-50" : ""}`}>
                      <div className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold border ${riskColor(s.riskLevel)}`}>
                        {s.studentName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-900">{s.studentName}</p>
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${riskBadge(s.riskLevel)}`}>
                            {s.riskLevel}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 truncate">{s.admissionNumber} · Year {s.year} · {s.course}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`text-base font-bold tabular-nums ${attendanceText(s.overallAttendance)}`}>{pct(s.overallAttendance)}</p>
                        <p className="text-xs text-gray-400">{s.totalAttended}/{s.totalSessions} sessions</p>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${expandedStudent === s.studentId ? "rotate-180" : ""}`} />
                    </div>
                    {expandedStudent === s.studentId && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                        className="px-5 pb-3 bg-gray-50 border-t border-gray-100"
                      >
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-2">Per-Unit Attendance</p>
                        {s.perCourseAttendance && Object.keys(s.perCourseAttendance).length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {Object.entries(s.perCourseAttendance).map(([code, v]) => {
                              const unitPct = v.sessions > 0 ? Math.round((v.attended / v.sessions) * 100) : 0;
                              return (
                                <div key={code} className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-mono font-semibold text-gray-700">{code}</span>
                                    <span className={`text-xs font-bold tabular-nums ${attendanceText(unitPct)}`}>{pct(unitPct)}</span>
                                  </div>
                                  <AttendanceBar rate={unitPct} />
                                  <p className="text-xs text-gray-400 mt-1">{v.attended} / {v.sessions} sessions</p>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400">No per-unit breakdown available.</p>
                        )}
                      </motion.div>
                    )}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* ════════════════════════ UNITS TAB ═══════════════════════════ */}
        {tab === "units" && (
          <motion.div key="units" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-3"
          >
            <div className="flex flex-wrap gap-2 text-xs">
              {[
                { label: "Good ≥75%",    bg: "bg-emerald-500" },
                { label: "Watch 60–74%", bg: "bg-yellow-400" },
                { label: "Risk 40–59%",  bg: "bg-amber-500" },
                { label: "Critical <40%",bg: "bg-rose-500" },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5 text-gray-500">
                  <div className={`h-2.5 w-2.5 rounded-full ${l.bg}`} />
                  {l.label}
                </div>
              ))}
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2">
                    <Skeleton className="h-5 w-28" /><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            ) : filteredUnits.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white py-14">
                <EmptyState icon={BookOpen} text="No units found" />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredUnits.map((u, i) => (
                  <motion.div key={u.unitCode} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className={`rounded-2xl border bg-white p-4 space-y-3 ${
                      u.avgAttendance >= 75 ? "border-emerald-200" :
                      u.avgAttendance >= 60 ? "border-yellow-200" :
                      u.avgAttendance >= 40 ? "border-amber-200" :
                      "border-rose-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-mono font-bold text-gray-800">{u.unitCode}</p>
                        <p className="text-sm text-gray-600 mt-0.5 line-clamp-2">{u.unitTitle}</p>
                        {u.lecturerName && u.lecturerName !== "—" && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate">{u.lecturerName}</p>
                        )}
                      </div>
                      <div className={`shrink-0 text-xl font-bold tabular-nums ${attendanceText(u.avgAttendance)}`}>{pct(u.avgAttendance)}</div>
                    </div>
                    <AttendanceBar rate={u.avgAttendance} />
                    <div className="grid grid-cols-3 gap-2 text-center border-t border-gray-100 pt-3">
                      <div><p className="text-xs text-gray-400">Enrolled</p><p className="text-sm font-bold text-gray-900">{u.enrolled}</p></div>
                      <div><p className="text-xs text-gray-400">Sessions</p><p className="text-sm font-bold text-gray-900">{u.sessionsHeld}</p></div>
                      <div><p className="text-xs text-gray-400">At Risk</p><p className={`text-sm font-bold ${u.atRiskCount > 0 ? "text-rose-600" : "text-gray-900"}`}>{u.atRiskCount}</p></div>
                    </div>
                    {/* Lesson type + assignment chips */}
                    <div className="flex flex-wrap gap-1 pt-1 border-t border-gray-100">
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
                      {u.semSessions > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-purple-50 border border-purple-200 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                          <BarChart2 className="h-2.5 w-2.5" />{u.semSessions} SEM
                        </span>
                      )}
                      {u.assignmentsPosted > 0 && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                          <FileText className="h-2.5 w-2.5" />{u.assignmentsPosted} Assign.
                        </span>
                      )}
                      {u.lecSessions === 0 && u.catSessions === 0 && u.ratSessions === 0 && u.labSessions === 0 && u.gdSessions === 0 && u.assignmentsPosted === 0 && (
                        <span className="text-[10px] text-gray-400">{u.sessionsHeld} session{u.sessionsHeld !== 1 ? "s" : ""}</span>
                      )}
                    </div>
                    {u.lowActivity && (
                      <div className="text-xs text-amber-600 flex items-center gap-1.5 bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-200">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Low activity — fewer than 2 sessions recorded
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}
        {/* ══════════════════════ INSIGHTS TAB ═════════════════════════ */}
        {tab === "insights" && (
          <motion.div key="insights" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-5"
          >
            {/* Predictive summary cards */}
            {!loading && data?.predictive && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: "Near Threshold",   value: data.predictive.summary.studentsNearThreshold,   sub: "Within 75% — at risk zone", icon: Target,      color: "text-amber-600",  bg: "bg-amber-50"  },
                  { label: "Velocity Decline", value: data.predictive.summary.studentsVelocityDecline, sub: "Attendance falling week-on-week", icon: TrendingDown, color: "text-rose-600",   bg: "bg-rose-50"   },
                  { label: "Consec. Absences", value: data.predictive.summary.studentsConsecAbsent,    sub: "3+ sessions missed in a row", icon: Zap,          color: "text-orange-600", bg: "bg-orange-50" },
                  { label: "Ghost Units",      value: data.predictive.summary.ghostEnrollmentUnitCount,sub: "Very low engagement vs enrolled", icon: Ghost,    color: "text-violet-600", bg: "bg-violet-50" },
                ].map(c => (
                  <div key={c.label} className="rounded-2xl border border-gray-200 bg-white p-4 flex items-center gap-3">
                    <div className={`shrink-0 flex h-10 w-10 items-center justify-center rounded-xl ${c.bg}`}>
                      <c.icon className={`h-5 w-5 ${c.color}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs text-gray-400">{c.label}</p>
                      <p className={`text-xl font-bold ${c.color} tabular-nums`}>{c.value}</p>
                      <p className="text-xs text-gray-400 truncate">{c.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loading && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2">
                    <Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-16" />
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* 1. Threshold Proximity */}
              <div className="rounded-2xl border border-amber-200 bg-white p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
                    <Target className="h-4 w-4 text-amber-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Threshold Proximity</h2>
                    <p className="text-xs text-gray-400">Students within watch/warning range of 75% minimum</p>
                  </div>
                </div>
                {loading ? (
                  <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : (data?.predictive?.thresholdProximity ?? []).length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8">
                    <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                    <p className="text-sm text-gray-400">All students comfortably above threshold</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {(data?.predictive?.thresholdProximity ?? []).slice(0, 25).map(s => (
                      <div key={s.studentId} className="flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">{s.studentName}</p>
                          <p className="text-xs text-gray-400">{s.admissionNumber} · Year {s.year}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`text-sm font-bold tabular-nums ${attendanceText(s.overallAttendance)}`}>{pct(s.overallAttendance)}</p>
                          {s.sessionsNeededGlobal > 0 && (
                            <p className="text-xs text-amber-600">needs {s.sessionsNeededGlobal} more</p>
                          )}
                          {s.unitsAtThreshold > 0 && (
                            <p className="text-xs text-amber-600">{s.unitsAtThreshold} unit{s.unitsAtThreshold > 1 ? "s" : ""} at risk</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. Attendance Velocity */}
              <div className="rounded-2xl border border-rose-200 bg-white p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50">
                    <TrendingDown className="h-4 w-4 text-rose-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Attendance Velocity</h2>
                    <p className="text-xs text-gray-400">Week-over-week trend — declining students</p>
                  </div>
                </div>
                {loading ? (
                  <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : (data?.predictive?.velocityDeclines ?? []).length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8">
                    <TrendingUp className="h-8 w-8 text-emerald-400" />
                    <p className="text-sm text-gray-400">No attendance velocity declines detected</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {(data?.predictive?.velocityDeclines ?? []).slice(0, 25).map(s => (
                      <div key={s.studentId} className="flex items-center gap-3 rounded-xl border border-rose-100 bg-rose-50/50 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">{s.studentName}</p>
                          <p className="text-xs text-gray-400">{s.admissionNumber} · Year {s.year}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`text-sm font-bold tabular-nums ${attendanceText(s.overallAttendance)}`}>{pct(s.overallAttendance)}</p>
                          <p className="text-xs text-rose-600 flex items-center justify-end gap-0.5">
                            <ArrowDownRight className="h-3 w-3" />
                            {Math.abs(s.velocityDelta)}pp this period
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 3. End-of-Semester Projection */}
              <div className="rounded-2xl border border-indigo-200 bg-white p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
                    <TrendingUp className="h-4 w-4 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Projected End-of-Period Rate</h2>
                    <p className="text-xs text-gray-400">Extrapolated if current velocity continues</p>
                  </div>
                </div>
                {loading ? (
                  <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {(data?.predictive?.velocityDeclines ?? [])
                      .filter(s => s.projectedEndRate < 75)
                      .slice(0, 25).map(s => (
                      <div key={s.studentId} className="flex items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">{s.studentName}</p>
                          <p className="text-xs text-gray-400">{s.admissionNumber}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`text-sm font-bold tabular-nums ${attendanceText(s.overallAttendance)}`}>{pct(s.overallAttendance)} now</p>
                          <p className={`text-xs font-semibold ${s.projectedEndRate < 60 ? "text-rose-600" : "text-amber-600"}`}>
                            → {pct(s.projectedEndRate)} projected
                          </p>
                        </div>
                      </div>
                    ))}
                    {(data?.predictive?.velocityDeclines ?? []).filter(s => s.projectedEndRate < 75).length === 0 && (
                      <div className="flex flex-col items-center gap-2 py-8">
                        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                        <p className="text-sm text-gray-400">No students projected below 75%</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 4. Consecutive Absence Alerts */}
              <div className="rounded-2xl border border-orange-200 bg-white p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50">
                    <Zap className="h-4 w-4 text-orange-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Consecutive Absence Alerts</h2>
                    <p className="text-xs text-gray-400">Students with 3+ sessions missed in a row</p>
                  </div>
                </div>
                {loading ? (
                  <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : (data?.predictive?.consecutiveAlerts ?? []).length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8">
                    <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                    <p className="text-sm text-gray-400">No consecutive absence streaks detected</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {(data?.predictive?.consecutiveAlerts ?? []).slice(0, 25).map(s => (
                      <div key={s.studentId} className="flex items-center gap-3 rounded-xl border border-orange-100 bg-orange-50/50 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">{s.studentName}</p>
                          <p className="text-xs text-gray-400">{s.admissionNumber} · {s.worstStreakUnit || "—"}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-orange-600 tabular-nums">{s.maxConsecAbsences} missed</p>
                          <p className={`text-xs ${attendanceText(s.overallAttendance)}`}>{pct(s.overallAttendance)} overall</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 5. Ghost Enrollment — Unit Engagement Gap */}
              <div className="rounded-2xl border border-violet-200 bg-white p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50">
                    <Ghost className="h-4 w-4 text-violet-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Unit Engagement Gap</h2>
                    <p className="text-xs text-gray-400">Units with &lt;30% avg attendance relative to enrolled — possible ghost enrollment</p>
                  </div>
                </div>
                {loading ? (
                  <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : (data?.predictive?.ghostEnrollmentUnits ?? []).length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-8">
                    <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                    <p className="text-sm text-gray-400">No ghost-enrollment patterns detected</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {(data?.predictive?.ghostEnrollmentUnits ?? []).map(u => (
                      <div key={u.unitCode} className="flex items-center gap-3 rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-mono font-bold text-gray-800">{u.unitCode}</p>
                          <p className="text-xs text-gray-500 truncate">{u.unitTitle}</p>
                          <p className="text-xs text-gray-400 truncate">{u.lecturerName}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold text-violet-600 tabular-nums">{pct(u.avgAttendance)}</p>
                          <p className="text-xs text-gray-400">{u.enrolled} enrolled · {u.sessionsHeld} sess.</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 6. Lecturer Session Regularity */}
              <div className="rounded-2xl border border-sky-200 bg-white p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50">
                    <Clock className="h-4 w-4 text-sky-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Lecturer Session Regularity</h2>
                    <p className="text-xs text-gray-400">Consistency of weekly session frequency (100 = perfectly regular)</p>
                  </div>
                </div>
                {loading ? (
                  <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : (data?.predictive?.lecturerRegularity ?? []).length === 0 ? (
                  <EmptyState icon={GraduationCap} text="No session data available" />
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {(data?.predictive?.lecturerRegularity ?? []).slice(0, 20).map(l => (
                      <div key={l.lecturerId} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2">
                        <div className="miniRing relative shrink-0">
                          <MiniRing value={l.regularityScore} color={l.regularityScore >= 75 ? "#10b981" : l.regularityScore >= 50 ? "#f59e0b" : "#f43f5e"} size={40} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">{l.lecturerName}</p>
                          <p className="text-xs text-gray-400">{l.weeksActive} weeks · avg {l.weeklySessionAvg}/wk</p>
                        </div>
                        <span className={`shrink-0 text-sm font-bold tabular-nums ${
                          l.regularityScore >= 75 ? "text-emerald-600" :
                          l.regularityScore >= 50 ? "text-amber-600" : "text-rose-600"
                        }`}>{l.regularityScore}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 7. Weekly Trend Chart */}
            {!loading && (data?.weeklyTrend ?? []).length > 1 && (
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
                    <BarChart2 className="h-4 w-4 text-indigo-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Weekly Session Trend</h2>
                    <p className="text-xs text-gray-400">Sessions conducted and avg students present per week</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <div className="flex items-end gap-2 min-w-max pb-1" style={{ minHeight: 100 }}>
                    {(data?.weeklyTrend ?? []).map(w => {
                      const maxAvg = Math.max(...(data?.weeklyTrend ?? []).map(x => x.avgPresent), 1);
                      const barH   = Math.max(4, Math.round((w.avgPresent / maxAvg) * 80));
                      return (
                        <div key={w.week} className="flex flex-col items-center gap-1 w-12 shrink-0">
                          <span className="text-[10px] text-gray-400 tabular-nums">{w.avgPresent}</span>
                          <div className="relative w-8">
                            <div className="w-full bg-indigo-500 rounded-t-sm" style={{ height: barH }} />
                          </div>
                          <span className="text-[10px] text-gray-400 tabular-nums rotate-45 origin-left mt-1" style={{ writingMode: "initial" }}>
                            {w.week.replace(/\d{4}-/, "")}
                          </span>
                          <span className="text-[9px] text-gray-300 tabular-nums">{w.sessions}s</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 8. Day-of-Week Absenteeism Heatmap */}
            {!loading && (data?.dowAbsenteeism ?? []).length > 0 && (
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50">
                    <Calendar className="h-4 w-4 text-rose-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Day-of-Week Attendance Heatmap</h2>
                    <p className="text-xs text-gray-400">Average attendance rate by day — darker = lower attendance</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">
                  {(data?.dowAbsenteeism ?? []).map(d => {
                    const rate = d.avgAttendancePct ?? 0;
                    return (
                      <div key={d.day} className={`rounded-xl border px-3 py-3 text-center ${
                        rate >= 75 ? "border-emerald-200 bg-emerald-50" :
                        rate >= 60 ? "border-yellow-200 bg-yellow-50" :
                        rate >= 40 ? "border-amber-200 bg-amber-50" :
                        "border-rose-200 bg-rose-50"
                      }`}>
                        <p className="text-xs font-semibold text-gray-700">{d.day.slice(0, 3)}</p>
                        <p className={`text-xl font-bold mt-1 tabular-nums ${attendanceText(rate)}`}>
                          {d.avgAttendancePct !== null ? pct(rate) : "—"}
                        </p>
                        <p className="text-xs text-gray-400">{d.sessions} sess.</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 8. Attendance Distribution */}
            {!loading && (data?.distribution ?? []).some(b => b.count > 0) && (
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50">
                    <Activity className="h-4 w-4 text-sky-600" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900">Attendance Distribution</h2>
                    <p className="text-xs text-gray-400">Student count by attendance rate bucket</p>
                  </div>
                </div>
                {(() => {
                  const maxBucket = Math.max(...(data?.distribution ?? []).map(b => b.count), 1);
                  return (
                    <div className="flex items-end gap-1.5">
                      {(data?.distribution ?? []).map((b, i) => {
                        const barH = Math.max(4, Math.round((b.count / maxBucket) * 100));
                        const bucketPct = parseInt(b.range);
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <span className="text-[10px] text-gray-500 tabular-nums">{b.count}</span>
                            <div style={{ height: barH }} className={`w-full rounded-t-sm ${
                              bucketPct >= 70 ? "bg-emerald-400" :
                              bucketPct >= 60 ? "bg-yellow-400" :
                              bucketPct >= 40 ? "bg-amber-400" :
                              "bg-rose-400"
                            }`} />
                            <span className="text-[9px] text-gray-400 hidden sm:block">{b.range.split("–")[0]}%</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
