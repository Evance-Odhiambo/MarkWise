"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, Download, Filter, Users, BookOpen, ClipboardCheck, AlertTriangle,
} from "lucide-react";
import { useAcademicRegistrar } from "../../context";

interface Student { id: string; name: string; admissionNumber: string; email: string; departmentId: string; courseId: string; course?: { name: string; code: string }; department?: { name: string } }
interface AttendanceRecord { id: string; studentId: string; date: string; status: string }
interface Dept { id: string; name: string }
interface Course { id: string; name: string; code: string; departmentId: string }

type ReportType = "students" | "enrollment" | "attendance";

const REPORT_TYPES: { id: ReportType; label: string; icon: typeof Users; color: string; desc: string }[] = [
  { id: "students", label: "Student Roster", icon: Users, color: "text-emerald-600", desc: "Full list of registered students with contact info" },
  { id: "enrollment", label: "Enrollment Summary", icon: BookOpen, color: "text-sky-600", desc: "Course enrolment counts per department" },
  { id: "attendance", label: "Attendance Summary", icon: ClipboardCheck, color: "text-teal-600", desc: "Attendance rates per student for the institution" },
];

function exportCSV(filename: string, rows: string[][], headers: string[]) {
  const lines = [headers.join(","), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))];
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const admin = useAcademicRegistrar();
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportType, setReportType] = useState<ReportType>("students");
  const [deptFilter, setDeptFilter] = useState("all");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    const [s, att, d, c] = await Promise.all([
      fetch(`/api/students?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/attendance?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/departments?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/courses?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
    ]);
    setStudents(s.students ?? s.data ?? s ?? []);
    setRecords(att.records ?? att.data ?? att ?? []);
    setDepts(d.departments ?? d.data ?? d ?? []);
    setCourses(c.courses ?? c.data ?? c ?? []);
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { load(); }, [load]);

  /* ---------- preview data ---------- */
  const filteredStudents = students.filter(s => deptFilter === "all" || s.departmentId === deptFilter);

  const previewRows = (() => {
    if (reportType === "students") {
      return filteredStudents.slice(0, 10).map(s => [
        s.name, s.admissionNumber, s.email,
        s.course?.name ?? "—", s.department?.name ?? "—",
      ]);
    }
    if (reportType === "enrollment") {
      const map: Record<string, { deptName: string; count: number; courses: Set<string> }> = {};
      filteredStudents.forEach(s => {
        if (!map[s.departmentId]) map[s.departmentId] = { deptName: s.department?.name ?? s.departmentId, count: 0, courses: new Set() };
        map[s.departmentId].count++;
        if (s.courseId) map[s.departmentId].courses.add(s.courseId);
      });
      return Object.values(map).slice(0, 10).map(r => [r.deptName, String(r.count), String(r.courses.size)]);
    }
    if (reportType === "attendance") {
      const studentSet = new Set(filteredStudents.map(s => s.id));
      const map: Record<string, { name: string; admNo: string; present: number; total: number }> = {};
      records.filter(r => studentSet.has(r.studentId)).forEach(r => {
        if (!map[r.studentId]) {
          const s = students.find(st => st.id === r.studentId);
          map[r.studentId] = { name: s?.name ?? "—", admNo: s?.admissionNumber ?? "—", present: 0, total: 0 };
        }
        map[r.studentId].total++;
        if (r.status === "present") map[r.studentId].present++;
      });
      return Object.values(map).slice(0, 10).map(r => [
        r.name, r.admNo, String(r.total), String(r.present),
        r.total > 0 ? `${Math.round((r.present / r.total) * 100)}%` : "—",
      ]);
    }
    return [];
  })();

  const HEADERS: Record<ReportType, string[]> = {
    students:   ["Name", "Admission No.", "Email", "Course", "Department"],
    enrollment: ["Department", "Students", "Courses"],
    attendance: ["Name", "Admission No.", "Total Sessions", "Present", "Attendance Rate"],
  };

  const handleExport = () => {
    setGenerating(true);
    setTimeout(() => {
      let rows: string[][] = [];
      const headers = HEADERS[reportType];
      if (reportType === "students") {
        rows = filteredStudents.map(s => [s.name, s.admissionNumber, s.email, s.course?.name ?? "", s.department?.name ?? ""]);
      } else if (reportType === "enrollment") {
        const map: Record<string, { deptName: string; count: number; courses: Set<string> }> = {};
        filteredStudents.forEach(s => {
          if (!map[s.departmentId]) map[s.departmentId] = { deptName: s.department?.name ?? s.departmentId, count: 0, courses: new Set() };
          map[s.departmentId].count++; if (s.courseId) map[s.departmentId].courses.add(s.courseId);
        });
        rows = Object.values(map).map(r => [r.deptName, String(r.count), String(r.courses.size)]);
      } else {
        const studentSet = new Set(filteredStudents.map(s => s.id));
        const map: Record<string, { name: string; admNo: string; present: number; total: number }> = {};
        records.filter(r => studentSet.has(r.studentId)).forEach(r => {
          if (!map[r.studentId]) { const s = students.find(st => st.id === r.studentId); map[r.studentId] = { name: s?.name ?? "—", admNo: s?.admissionNumber ?? "—", present: 0, total: 0 }; }
          map[r.studentId].total++; if (r.status === "present") map[r.studentId].present++;
        });
        rows = Object.values(map).map(r => [r.name, r.admNo, String(r.total), String(r.present), r.total > 0 ? `${Math.round((r.present / r.total) * 100)}%` : "—"]);
      }
      exportCSV(`${reportType}-report-${new Date().toISOString().slice(0,10)}.csv`, rows, headers);
      setGenerating(false);
    }, 300);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-cyan-600" /> Reports
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Generate and export registry reports as CSV</p>
        </div>
        <button onClick={handleExport} disabled={generating || loading}
          className="flex items-center gap-1.5 rounded-xl bg-cyan-600 px-3.5 py-2 text-sm font-medium text-gray-900 hover:bg-cyan-500 disabled:opacity-50">
          <Download className="h-4 w-4" /> {generating ? "Generating…" : "Export CSV"}
        </button>
      </div>

      {/* Report type selector */}
      <div className="grid gap-3 sm:grid-cols-3">
        {REPORT_TYPES.map(r => (
          <button key={r.id} onClick={() => setReportType(r.id)}
            className={`rounded-2xl border p-4 text-left transition-colors ${reportType === r.id ? "border-cyan-500/40 bg-cyan-500/10" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
            <r.icon className={`h-5 w-5 mb-2 ${r.color}`} />
            <div className="font-medium text-gray-800 text-sm">{r.label}</div>
            <div className="text-xs text-gray-400 mt-0.5">{r.desc}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3.5 w-3.5 text-gray-500" />
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
          <option value="all">All Departments</option>
          {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <span className="text-xs text-gray-400">
          Preview: first 10 rows of {reportType === "students" ? filteredStudents.length : previewRows.length} records
        </span>
      </div>

      {/* Preview table */}
      <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-500">Preview</span>
          <span className="text-xs text-gray-500">{REPORT_TYPES.find(r => r.id === reportType)?.label}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                {HEADERS[reportType].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-gray-200/50">
                    {HEADERS[reportType].map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 rounded bg-gray-200 animate-pulse" /></td>)}
                  </tr>
                ))
              ) : previewRows.length === 0 ? (
                <tr><td colSpan={HEADERS[reportType].length} className="py-10 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <AlertTriangle className="h-6 w-6 text-slate-700" />
                    <p className="text-gray-400 text-xs">No data available for this report</p>
                  </div>
                </td></tr>
              ) : previewRows.map((row, i) => (
                <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  className="border-b border-gray-200/40 hover:bg-gray-50">
                  {row.map((cell, j) => <td key={j} className="px-4 py-2.5 text-gray-700 text-xs">{cell}</td>)}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
