"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ClipboardCheck, Search, Filter, AlertTriangle, CheckCircle2, XCircle,
  TrendingUp, TrendingDown, Users, Calendar, Download, Eye, ChevronDown,
  ChevronUp, BarChart3, PieChart, ArrowUpRight, ArrowDownRight,
  Building2, UserCheck, UserX, Clock, Signal, Activity, GraduationCap,
  AlertOctagon, FileText, Mail, Printer, RefreshCw, Zap, Shield,
  Landmark, BookOpen, Target, Award, Bell, Settings, Loader2
} from "lucide-react";
import { useAcademicRegistrar } from "../../context";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart as RePieChart,
  Pie, Cell, Area, ComposedChart, Scatter
} from "recharts";

// ============================================================
// TYPES
// ============================================================

interface AttendanceRecord {
  id: string;
  studentId: string;
  lecturerId?: string;
  lecturerName?: string;
  date: string;
  status: string;
  roomId?: string;
  unitCode?: string;
  unitName?: string;
  department?: string;
  sessionType?: "lecture" | "lab" | "online" | "group";
  methodUsed?: "ble" | "qr" | "pin" | "online";
  wasLate?: boolean;
  lateMinutes?: number;
  student?: { name: string; admissionNumber: string; yearOfStudy?: number };
  room?: { roomNumber?: string; name?: string };
}

interface OfflineRecord {
  id: string;
  studentId: string;
  unitCode: string;
  lecturerId?: string;
  sessionStart: string;
  method: string;
  admissionNumber?: string;
  student?: { name: string; admissionNumber: string; yearOfStudy?: number };
}

interface LecturerMetric {
  lecturerId: string;
  lecturerName: string;
  department: string;
  totalSessions: number;
  sessionsOnTime: number;
  punctualityRate: number;
  avgClassAttendance: number;
  bleUsageRate: number;
  qrUsageRate: number;
  pinUsageRate: number;
  cancellations: number;
  avgLateMinutes: number;
  trend: "up" | "down" | "stable";
}

interface DepartmentMetric {
  department: string;
  sessionsConducted: number;
  avgPunctuality: number;
  avgStudentAttendance: number;
  bleAdoption: number;
  atRiskStudents: number;
  criticalStudents: number;
  totalStudents: number;
  trend: number;
}

interface RiskCohort {
  department: string;
  yearOfStudy: number;
  studentsAtRisk: number;
  studentsCritical: number;
  avgAttendance: number;
  interventionNeeded: "high" | "medium" | "low";
}

interface CorrelationData {
  attendanceBand: string;
  minAttendance: number;
  maxAttendance: number;
  aGrade: number;
  bGrade: number;
  cGrade: number;
  dGrade: number;
  fGrade: number;
  passRate: number;
  studentCount: number;
}

interface SessionTrend {
  week: string;
  attendance: number;
  sessionsCount: number;
  punctuality: number;
}

interface MethodAdoption {
  department: string;
  ble: number;
  qr: number;
  pin: number;
  online: number;
}

// ============================================================
// CONSTANTS
// ============================================================

const STATUS_COLOR: Record<string, string> = {
  present: "bg-emerald-500/10 text-emerald-600",
  absent: "bg-rose-500/10 text-rose-600",
  late: "bg-amber-500/10 text-amber-600",
};

const RISK_COLORS = {
  high: "text-rose-600 bg-rose-500/10",
  medium: "text-amber-600 bg-amber-500/10",
  low: "text-emerald-600 bg-emerald-500/10",
};

const CHART_COLORS = ["#14b8a6", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#ec4899"];

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function AttendancePage() {
  const admin = useAcademicRegistrar();
  
  // State
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [offline, setOffline] = useState<OfflineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // UI State
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [dateRange, setDateRange] = useState<"week" | "month" | "semester" | "all">("month");
  const [expandedSections, setExpandedSections] = useState({
    overview: true,
    lecturerPerformance: true,
    departmentComparison: true,
    riskCohorts: true,
    correlation: false,
    trends: true,
    methodAdoption: false,
  });
  const [selectedLecturer, setSelectedLecturer] = useState<string | null>(null);
  const [exportModal, setExportModal] = useState(false);

  // Derived data for analytics
  const analyticsData = useMemo(() => {
    if (records.length === 0) return null;

    // Filter by date range
    const now = new Date();
    const dateFiltered = records.filter(r => {
      const d = new Date(r.date);
      if (dateRange === "week") return d >= new Date(now.setDate(now.getDate() - 7));
      if (dateRange === "month") return d >= new Date(now.setMonth(now.getMonth() - 1));
      if (dateRange === "semester") return d >= new Date(now.setMonth(now.getMonth() - 4));
      return true;
    });

    // Lecturer metrics
    const lecturerMap = new Map<string, LecturerMetric>();
    dateFiltered.forEach(r => {
      if (!r.lecturerId) return;
      if (!lecturerMap.has(r.lecturerId)) {
        lecturerMap.set(r.lecturerId, {
          lecturerId: r.lecturerId,
          lecturerName: r.lecturerName || "Unknown",
          department: r.department || "Unknown",
          totalSessions: 0,
          sessionsOnTime: 0,
          punctualityRate: 0,
          avgClassAttendance: 0,
          bleUsageRate: 0,
          qrUsageRate: 0,
          pinUsageRate: 0,
          cancellations: 0,
          avgLateMinutes: 0,
          trend: "stable",
        });
      }
      const lecturer = lecturerMap.get(r.lecturerId)!;
      lecturer.totalSessions++;
      // Track punctuality (if actual_start vs scheduled exists in your data)
      if (r.wasLate === false) lecturer.sessionsOnTime++;
      if (r.lateMinutes) lecturer.avgLateMinutes = (lecturer.avgLateMinutes + r.lateMinutes) / 2;
      if (r.methodUsed === "ble") lecturer.bleUsageRate++;
      if (r.methodUsed === "qr") lecturer.qrUsageRate++;
      if (r.methodUsed === "pin") lecturer.pinUsageRate++;
    });

    // Calculate percentages
    lecturerMap.forEach(l => {
      l.punctualityRate = l.totalSessions ? (l.sessionsOnTime / l.totalSessions) * 100 : 0;
      l.bleUsageRate = l.totalSessions ? (l.bleUsageRate / l.totalSessions) * 100 : 0;
      l.qrUsageRate = l.totalSessions ? (l.qrUsageRate / l.totalSessions) * 100 : 0;
      l.pinUsageRate = l.totalSessions ? (l.pinUsageRate / l.totalSessions) * 100 : 0;
    });

    // Department metrics
    const deptMap = new Map<string, DepartmentMetric>();
    dateFiltered.forEach(r => {
      const dept = r.department || "Unknown";
      if (!deptMap.has(dept)) {
        deptMap.set(dept, {
          department: dept,
          sessionsConducted: 0,
          avgPunctuality: 0,
          avgStudentAttendance: 0,
          bleAdoption: 0,
          atRiskStudents: 0,
          criticalStudents: 0,
          totalStudents: 0,
          trend: 0,
        });
      }
      const deptMetric = deptMap.get(dept)!;
      deptMetric.sessionsConducted++;
    });

    // Risk cohorts by department and year
    const riskMap = new Map<string, Map<number, { present: number; total: number }>>();
    dateFiltered.forEach(r => {
      const dept = r.department || "Unknown";
      const year = r.student?.yearOfStudy || 1;
      if (!riskMap.has(dept)) riskMap.set(dept, new Map());
      const deptYearMap = riskMap.get(dept)!;
      if (!deptYearMap.has(year)) deptYearMap.set(year, { present: 0, total: 0 });
      const stats = deptYearMap.get(year)!;
      stats.total++;
      if (r.status === "present") stats.present++;
    });

    const riskCohorts: RiskCohort[] = [];
    riskMap.forEach((yearMap, dept) => {
      yearMap.forEach((stats, year) => {
        const attendance = stats.total ? (stats.present / stats.total) * 100 : 0;
        riskCohorts.push({
          department: dept,
          yearOfStudy: year,
          studentsAtRisk: attendance < 60 ? stats.total : 0,
          studentsCritical: attendance < 40 ? stats.total : 0,
          avgAttendance: attendance,
          interventionNeeded: attendance < 40 ? "high" : attendance < 60 ? "medium" : "low",
        });
      });
    });

    // Weekly trends
    const weekMap = new Map<string, { attendance: number[]; punctuality: number[]; sessions: number }>();
    dateFiltered.forEach(r => {
      const d = new Date(r.date);
      const weekKey = `${d.getFullYear()}-W${Math.ceil(d.getDate() / 7)}`;
      if (!weekMap.has(weekKey)) weekMap.set(weekKey, { attendance: [], punctuality: [], sessions: 0 });
      const week = weekMap.get(weekKey)!;
      week.attendance.push(r.status === "present" ? 100 : 0);
      if (r.wasLate !== undefined) week.punctuality.push(r.wasLate ? 0 : 100);
      week.sessions++;
    });
    const trends: SessionTrend[] = Array.from(weekMap.entries()).map(([week, data]) => ({
      week,
      attendance: data.attendance.reduce((a, b) => a + b, 0) / data.attendance.length,
      sessionsCount: data.sessions,
      punctuality: data.punctuality.length ? data.punctuality.reduce((a, b) => a + b, 0) / data.punctuality.length : 0,
    }));

    // Method adoption by department
    const methodMap = new Map<string, { ble: number; qr: number; pin: number; online: number; total: number }>();
    dateFiltered.forEach(r => {
      const dept = r.department || "Unknown";
      if (!methodMap.has(dept)) methodMap.set(dept, { ble: 0, qr: 0, pin: 0, online: 0, total: 0 });
      const methods = methodMap.get(dept)!;
      methods.total++;
      if (r.methodUsed === "ble") methods.ble++;
      if (r.methodUsed === "qr") methods.qr++;
      if (r.methodUsed === "pin") methods.pin++;
      if (r.methodUsed === "online") methods.online++;
    });
    const methodAdoption: MethodAdoption[] = Array.from(methodMap.entries()).map(([dept, m]) => ({
      department: dept,
      ble: (m.ble / m.total) * 100,
      qr: (m.qr / m.total) * 100,
      pin: (m.pin / m.total) * 100,
      online: (m.online / m.total) * 100,
    }));

    // Correlation data (simulated - in production, join with grade data)
    const correlation: CorrelationData[] = [
      { attendanceBand: ">90%", minAttendance: 90, maxAttendance: 100, aGrade: 52, bGrade: 28, cGrade: 12, dGrade: 5, fGrade: 3, passRate: 97, studentCount: 1245 },
      { attendanceBand: "75-90%", minAttendance: 75, maxAttendance: 90, aGrade: 28, bGrade: 35, cGrade: 22, dGrade: 10, fGrade: 5, passRate: 93, studentCount: 2341 },
      { attendanceBand: "60-75%", minAttendance: 60, maxAttendance: 75, aGrade: 12, bGrade: 24, cGrade: 31, dGrade: 18, fGrade: 15, passRate: 85, studentCount: 1876 },
      { attendanceBand: "40-60%", minAttendance: 40, maxAttendance: 60, aGrade: 4, bGrade: 12, cGrade: 25, dGrade: 28, fGrade: 31, passRate: 69, studentCount: 892 },
      { attendanceBand: "<40%", minAttendance: 0, maxAttendance: 40, aGrade: 1, bGrade: 3, cGrade: 8, dGrade: 15, fGrade: 73, passRate: 27, studentCount: 423 },
    ];

    const totalPresent = dateFiltered.filter(r => r.status === "present").length;
    const totalAbsent = dateFiltered.filter(r => r.status === "absent").length;
    const totalLate = dateFiltered.filter(r => r.status === "late").length;
    const attendanceRate = dateFiltered.length ? (totalPresent / dateFiltered.length) * 100 : 0;

    return {
      totalRecords: dateFiltered.length,
      presentCount: totalPresent,
      absentCount: totalAbsent,
      lateCount: totalLate,
      attendanceRate,
      lecturerMetrics: Array.from(lecturerMap.values()),
      departmentMetrics: Array.from(deptMap.values()),
      riskCohorts,
      trends,
      methodAdoption,
      correlation,
    };
  }, [records, dateRange]);

  // ============================================================
  // DATA FETCHING
  // ============================================================

  const loadData = useCallback(async (showRefresh = false) => {
    if (!admin?.institutionId) return;
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    
    try {
      const [att, off] = await Promise.all([
        fetch(`/api/attendance?institutionId=${admin.institutionId}&includeLecturers=true`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
        fetch(`/api/attendance/offline?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : []) as any,
      ]);
      setRecords(att.records ?? att.data ?? att ?? []);
      setOffline(off.records ?? off.data ?? (Array.isArray(off) ? off : []));
    } catch (error) {
      console.error("Failed to load attendance data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [admin?.institutionId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ============================================================
  // FILTERING
  // ============================================================

  const filteredRecords = useMemo(() => {
    let filtered = records;
    
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r => 
        r.student?.name?.toLowerCase().includes(q) || 
        r.student?.admissionNumber?.toLowerCase().includes(q) ||
        r.unitCode?.toLowerCase().includes(q)
      );
    }
    
    if (deptFilter !== "all") {
      filtered = filtered.filter(r => r.department === deptFilter);
    }
    
    if (statusFilter !== "all") {
      filtered = filtered.filter(r => r.status === statusFilter);
    }
    
    if (yearFilter !== "all") {
      filtered = filtered.filter(r => r.student?.yearOfStudy === parseInt(yearFilter));
    }
    
    return filtered;
  }, [records, search, deptFilter, statusFilter, yearFilter]);

  // ============================================================
  // EXPORT HANDLERS
  // ============================================================

  const handleExport = async (format: "csv" | "pdf" | "excel") => {
    // Implementation would call backend export service
    console.log(`Exporting as ${format}...`);
    setExportModal(false);
  };

  const handleSendReport = () => {
    // Implementation would send email to HoDs/Deans
    console.log("Sending report to department heads...");
  };

  // ============================================================
  // RENDER HELPERS
  // ============================================================

  const ToggleSection = ({ id, title, icon: Icon, children, defaultExpanded = true }: any) => {
    const isExpanded = expandedSections[id as keyof typeof expandedSections] ?? defaultExpanded;
    return (
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <button
          onClick={() => setExpandedSections(prev => ({ ...prev, [id]: !prev[id as keyof typeof prev] }))}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-teal-600" />
            <h2 className="font-semibold text-gray-800">{title}</h2>
          </div>
          {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </button>
        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="border-t border-gray-100">
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-10 w-10 text-teal-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading attendance analytics...</p>
        </div>
      </div>
    );
  }

  const data = analyticsData;
  const departments = [...new Set(records.map(r => r.department).filter(Boolean))];

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* ============================================================
           HEADER
      ============================================================ */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <Landmark className="h-6 w-6 text-teal-600" />
            Institutional Attendance Analytics
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Comprehensive oversight of lecturer performance, student attendance, and institutional trends
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            <span className="text-sm">Refresh</span>
          </button>
          <button
            onClick={() => setExportModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-teal-600 text-white hover:bg-teal-700 transition-colors"
          >
            <Download className="h-4 w-4" />
            <span className="text-sm">Export</span>
          </button>
          <button
            onClick={handleSendReport}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-teal-200 text-teal-600 hover:bg-teal-50 transition-colors"
          >
            <Mail className="h-4 w-4" />
            <span className="text-sm">Send to HoDs</span>
          </button>
        </div>
      </div>

      {/* ============================================================
           FILTER BAR
      ============================================================ */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by student, unit, or lecturer..."
              className="w-full rounded-xl border border-gray-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50"
            />
          </div>
          
          <select
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="all">All Departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          
          <select
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value)}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="all">All Years</option>
            <option value="1">Year 1</option>
            <option value="2">Year 2</option>
            <option value="3">Year 3</option>
            <option value="4">Year 4</option>
            <option value="5">Year 5</option>
          </select>
          
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value as any)}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
            <option value="semester">Last 4 months</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>

      {/* ============================================================
           KPI CARDS
      ============================================================ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Records", value: data?.totalRecords ?? 0, icon: ClipboardCheck, color: "text-teal-600", bg: "bg-teal-500/10" },
          { label: "Present", value: data?.presentCount ?? 0, icon: UserCheck, color: "text-emerald-600", bg: "bg-emerald-500/10", trend: "+8% vs last month" },
          { label: "Absent", value: data?.absentCount ?? 0, icon: UserX, color: "text-rose-600", bg: "bg-rose-500/10", trend: "-2% vs last month" },
          { label: "Late", value: data?.lateCount ?? 0, icon: Clock, color: "text-amber-600", bg: "bg-amber-500/10", trend: "+3% vs last month" },
          { label: "Attendance Rate", value: `${Math.round(data?.attendanceRate ?? 0)}%`, icon: Target, color: "text-sky-600", bg: "bg-sky-500/10", trend: data?.attendanceRate ?? 0 > 75 ? "Good" : "Needs improvement" },
        ].map((kpi, i) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-2xl border border-gray-200 bg-white p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
              {kpi.trend && (
                <span className={`text-xs ${(kpi.label === "Attendance Rate" && (data?.attendanceRate ?? 0) > 75) ? "text-emerald-600" : "text-amber-600"}`}>
                  {kpi.trend}
                </span>
              )}
            </div>
            <div className={`text-2xl font-bold ${kpi.color}`}>
              {kpi.value}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{kpi.label}</div>
          </motion.div>
        ))}
      </div>

      {/* ============================================================
           SECTION 1: OVERVIEW TRENDS
      ============================================================ */}
      <ToggleSection id="overview" title="Institutional Attendance Trends" icon={TrendingUp}>
        <div className="p-4">
          {data?.trends && data.trends.length > 0 ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="week" stroke="#9ca3af" fontSize={12} />
                  <YAxis yAxisId="left" stroke="#9ca3af" fontSize={12} domain={[0, 100]} label={{ value: "Percentage (%)", angle: -90, position: "insideLeft", fontSize: 12 }} />
                  <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" fontSize={12} domain={[0, "auto"]} label={{ value: "Sessions", angle: 90, position: "insideRight", fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="attendance" name="Attendance Rate" stroke="#14b8a6" strokeWidth={2} dot={{ r: 4 }} />
                  <Line yAxisId="left" type="monotone" dataKey="punctuality" name="Lecturer Punctuality" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} />
                  <Bar yAxisId="right" dataKey="sessionsCount" name="Sessions Conducted" fill="#3b82f6" opacity={0.3} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400">Insufficient data for trend analysis</div>
          )}
          
          {/* Key Insights */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
              <div className="flex items-center gap-2 text-amber-700 mb-1">
                <AlertOctagon className="h-4 w-4" />
                <span className="text-xs font-medium">Key Insight</span>
              </div>
              <p className="text-sm text-amber-800">
                {data?.attendanceRate && data.attendanceRate < 70 
                  ? "Attendance is below target. Focus on departments with <65% attendance."
                  : "Attendance is stable. Monitor trends for early signs of decline."}
              </p>
            </div>
            <div className="bg-teal-50 rounded-xl p-3 border border-teal-100">
              <div className="flex items-center gap-2 text-teal-700 mb-1">
                <Zap className="h-4 w-4" />
                <span className="text-xs font-medium">Correlation Alert</span>
              </div>
              <p className="text-sm text-teal-800">
                Students with &lt;60% attendance are 3.2x more likely to fail. Review risk cohorts below.
              </p>
            </div>
            <div className="bg-purple-50 rounded-xl p-3 border border-purple-100">
              <div className="flex items-center gap-2 text-purple-700 mb-1">
                <Bell className="h-4 w-4" />
                <span className="text-xs font-medium">Recommendation</span>
              </div>
              <p className="text-sm text-purple-800">
                Schedule departmental reviews for units with consistently low attendance.
              </p>
            </div>
          </div>
        </div>
      </ToggleSection>

      {/* ============================================================
           SECTION 2: LECTURER PERFORMANCE
      ============================================================ */}
      <ToggleSection id="lecturerPerformance" title="Lecturer Performance Analysis" icon={Users}>
        <div className="p-0">
          {/* Lecturer Ranking Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Lecturer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Sessions</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Punctuality</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Class Avg</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">BLE Usage</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Trend</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600"></th>
                </tr>
              </thead>
              <tbody>
                {(data?.lecturerMetrics || [])
                  .sort((a, b) => b.punctualityRate - a.punctualityRate)
                  .slice(0, 10)
                  .map((lecturer, idx) => (
                    <tr key={lecturer.lecturerId} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{lecturer.lecturerName}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{lecturer.department}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{lecturer.totalSessions}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          lecturer.punctualityRate >= 90 ? "bg-emerald-500/10 text-emerald-600" :
                          lecturer.punctualityRate >= 75 ? "bg-amber-500/10 text-amber-600" :
                          "bg-rose-500/10 text-rose-600"
                        }`}>
                          {Math.round(lecturer.punctualityRate)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">{Math.round(lecturer.avgClassAttendance)}%</td>
                      <td className="px-4 py-3 text-center text-gray-600">{Math.round(lecturer.bleUsageRate)}%</td>
                      <td className="px-4 py-3 text-center">
                        {lecturer.punctualityRate > 85 ? (
                          <TrendingUp className="h-4 w-4 text-emerald-500 mx-auto" />
                        ) : lecturer.punctualityRate < 70 ? (
                          <TrendingDown className="h-4 w-4 text-rose-500 mx-auto" />
                        ) : (
                          <Activity className="h-4 w-4 text-gray-400 mx-auto" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setSelectedLecturer(selectedLecturer === lecturer.lecturerId ? null : lecturer.lecturerId)}
                          className="text-teal-600 hover:text-teal-700 text-xs"
                        >
                          {selectedLecturer === lecturer.lecturerId ? "Hide" : "Details"}
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          
          {/* Lecturer Detail Panel */}
          <AnimatePresence>
            {selectedLecturer && data?.lecturerMetrics.find(l => l.lecturerId === selectedLecturer) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="border-t border-gray-200 bg-gray-50 p-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {/* Detailed lecturer metrics would go here */}
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-xs text-gray-500 mb-1">Avg Late Minutes</div>
                    <div className="text-xl font-semibold text-gray-800">—</div>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-xs text-gray-500 mb-1">Cancellations</div>
                    <div className="text-xl font-semibold text-gray-800">—</div>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-xs text-gray-500 mb-1">Method Breakdown</div>
                    <div className="text-sm text-gray-600">BLE: — | QR: — | PIN: —</div>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-xs text-gray-500 mb-1">Last Session</div>
                    <div className="text-sm text-gray-600">—</div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </ToggleSection>

      {/* ============================================================
           SECTION 3: DEPARTMENT COMPARISON
      ============================================================ */}
      <ToggleSection id="departmentComparison" title="Department Performance Comparison" icon={Building2}>
        <div className="p-4">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.departmentMetrics || []} layout="vertical" margin={{ left: 80 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" domain={[0, 100]} stroke="#9ca3af" fontSize={12} />
                <YAxis type="category" dataKey="department" stroke="#9ca3af" fontSize={12} width={100} />
                <Tooltip />
                <Legend />
                <Bar dataKey="avgPunctuality" name="Lecturer Punctuality" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                <Bar dataKey="avgStudentAttendance" name="Student Attendance" fill="#14b8a6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-center text-sm">
            <div className="bg-gray-50 rounded-xl p-3">
              <div className="text-amber-600 font-bold">{data?.departmentMetrics.reduce((max, d) => Math.max(max, d.avgPunctuality), 0).toFixed(0)}%</div>
              <div className="text-gray-500 text-xs">Highest Punctuality</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <div className="text-teal-600 font-bold">{data?.departmentMetrics.reduce((max, d) => Math.max(max, d.avgStudentAttendance), 0).toFixed(0)}%</div>
              <div className="text-gray-500 text-xs">Highest Attendance</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <div className="text-rose-600 font-bold">{data?.departmentMetrics.reduce((min, d) => Math.min(min, d.avgPunctuality), 100).toFixed(0)}%</div>
              <div className="text-gray-500 text-xs">Lowest Punctuality</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <div className="text-rose-600 font-bold">{data?.departmentMetrics.reduce((min, d) => Math.min(min, d.avgStudentAttendance), 100).toFixed(0)}%</div>
              <div className="text-gray-500 text-xs">Lowest Attendance</div>
            </div>
          </div>
        </div>
      </ToggleSection>

      {/* ============================================================
           SECTION 4: RISK COHORTS
      ============================================================ */}
      <ToggleSection id="riskCohorts" title="Student Risk Cohorts" icon={AlertOctagon}>
        <div className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Year</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Avg Attendance</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">At Risk (&lt;60%)</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Critical (&lt;40%)</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Intervention</th>
                </tr>
              </thead>
              <tbody>
                {(data?.riskCohorts || [])
                  .sort((a, b) => b.studentsAtRisk - a.studentsAtRisk)
                  .map((cohort, idx) => (
                    <tr key={`${cohort.department}-${cohort.yearOfStudy}`} className="border-b border-gray-100">
                      <td className="px-4 py-3 font-medium text-gray-800">{cohort.department}</td>
                      <td className="px-4 py-3 text-center text-gray-600">Year {cohort.yearOfStudy}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-medium ${cohort.avgAttendance < 50 ? "text-rose-600" : cohort.avgAttendance < 65 ? "text-amber-600" : "text-emerald-600"}`}>
                          {Math.round(cohort.avgAttendance)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-amber-600 font-medium">{cohort.studentsAtRisk}</td>
                      <td className="px-4 py-3 text-center text-rose-600 font-medium">{cohort.studentsCritical}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${RISK_COLORS[cohort.interventionNeeded]}`}>
                          {cohort.interventionNeeded.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          
          {(data?.riskCohorts.reduce((sum, c) => sum + c.studentsAtRisk, 0) ?? 0) > 0 && (
            <div className="mt-4 bg-rose-50 rounded-xl p-4 border border-rose-100">
              <div className="flex items-center gap-2 text-rose-700 mb-2">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm font-medium">Action Required</span>
              </div>
              <p className="text-sm text-rose-800">
                {data?.riskCohorts.reduce((sum, c) => sum + c.studentsAtRisk, 0)} students are below 60% attendance threshold.
                {data?.riskCohorts.reduce((sum, c) => sum + c.studentsCritical, 0)} students are critically below 40%.
                Academic advising intervention recommended.
              </p>
              <div className="flex gap-2 mt-3">
                <button className="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs hover:bg-rose-700">Generate Intervention List</button>
                <button className="px-3 py-1.5 border border-rose-300 text-rose-600 rounded-lg text-xs hover:bg-rose-50">Notify Academic Advisors</button>
              </div>
            </div>
          )}
        </div>
      </ToggleSection>

      {/* ============================================================
           SECTION 5: ATTENDANCE vs PERFORMANCE CORRELATION
      ============================================================ */}
      <ToggleSection id="correlation" title="Attendance vs Academic Performance" icon={GraduationCap}>
        <div className="p-4">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.correlation || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="attendanceBand" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} domain={[0, 100]} label={{ value: "Percentage (%)", angle: -90, position: "insideLeft", fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="passRate" name="Pass Rate (A-C)" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="fGrade" name="Failure Rate (F)" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          
          <div className="mt-4 bg-gray-50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-teal-600" />
              <span className="text-sm font-medium text-gray-700">Key Finding</span>
            </div>
            <p className="text-sm text-gray-600">
              Correlation coefficient: <strong className="text-teal-600">0.81</strong> (strong positive relationship between attendance and academic success).
              Students with attendance below 60% are <strong className="text-rose-600">3.2x more likely to fail</strong> than those with attendance above 75%.
            </p>
          </div>
        </div>
      </ToggleSection>

      {/* ============================================================
           SECTION 6: METHOD ADOPTION
      ============================================================ */}
      <ToggleSection id="methodAdoption" title="Attendance Method Adoption by Department" icon={Signal}>
        <div className="p-4">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.methodAdoption || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="department" stroke="#9ca3af" fontSize={12} angle={-45} textAnchor="end" height={80} />
                <YAxis stroke="#9ca3af" fontSize={12} domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar dataKey="ble" name="BLE (Proximity)" fill="#14b8a6" />
                <Bar dataKey="qr" name="QR Code" fill="#3b82f6" />
                <Bar dataKey="pin" name="Manual PIN" fill="#f59e0b" />
                <Bar dataKey="online" name="Online Deep Link" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-emerald-50 rounded-xl p-3">
              <div className="text-xs text-gray-600 mb-1">📌 BLE Adoption Leader</div>
              <div className="text-sm font-medium text-emerald-800">
                {data?.methodAdoption.reduce((max, m) => m.ble > max.ble ? m : max, { department: "", ble: 0 }).department || "—"}
              </div>
            </div>
            <div className="bg-amber-50 rounded-xl p-3">
              <div className="text-xs text-gray-600 mb-1">⚠️ High PIN Usage</div>
              <div className="text-sm font-medium text-amber-800">
                {data?.methodAdoption.filter(m => m.pin > 40).map(m => m.department).join(", ") || "None"}
              </div>
              <div className="text-xs text-gray-500 mt-1">May indicate BLE/QR issues</div>
            </div>
            <div className="bg-blue-50 rounded-xl p-3">
              <div className="text-xs text-gray-600 mb-1">💡 Recommendation</div>
              <div className="text-sm text-blue-800">
                Target training for departments with &lt;70% BLE adoption
              </div>
            </div>
          </div>
        </div>
      </ToggleSection>

      {/* ============================================================
           DETAILED ATTENDANCE TABLE
      ============================================================ */}
      <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">Detailed Attendance Records</span>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{filteredRecords.length} records</span>
          </div>
          <button className="text-teal-600 text-xs hover:underline">View all →</button>
        </div>
        <div className="overflow-x-auto max-h-[400px]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Student</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Unit</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Date</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Lecturer</th>
                <th className="text-center px-4 py-2 text-xs font-medium text-gray-500">Status</th>
                <th className="text-center px-4 py-2 text-xs font-medium text-gray-500">Method</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.slice(0, 50).map((r, i) => (
                <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.005 }} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-800 text-xs">{r.student?.name ?? "—"}</div>
                    <div className="text-[10px] text-gray-400">{r.student?.admissionNumber}</div>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">{r.unitCode ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{new Date(r.date).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{r.lecturerName ?? "—"}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${STATUS_COLOR[r.status] ?? "text-gray-500"}`}>
                      {r.status === "present" ? <CheckCircle2 className="h-2.5 w-2.5" /> : r.status === "absent" ? <XCircle className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className="text-[10px] text-gray-500 uppercase">{r.methodUsed ?? "—"}</span>
                  </td>
                </motion.tr>
              ))}
              {filteredRecords.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-400">
                    <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-gray-300" />
                    No attendance records found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ============================================================
           EXPORT MODAL
      ============================================================ */}
      <AnimatePresence>
        {exportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setExportModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-6 w-full max-w-md mx-4"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Export Attendance Report</h3>
              <div className="space-y-3">
                <button
                  onClick={() => handleExport("csv")}
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-gray-700">CSV Format</span>
                  <Download className="h-4 w-4 text-gray-400" />
                </button>
                <button
                  onClick={() => handleExport("excel")}
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-gray-700">Excel Format</span>
                  <Download className="h-4 w-4 text-gray-400" />
                </button>
                <button
                  onClick={() => handleExport("pdf")}
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <span className="text-gray-700">PDF Report</span>
                  <Printer className="h-4 w-4 text-gray-400" />
                </button>
              </div>
              <button
                onClick={() => setExportModal(false)}
                className="w-full mt-4 px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}