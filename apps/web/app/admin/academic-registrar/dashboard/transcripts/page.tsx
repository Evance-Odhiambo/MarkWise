"use client";
import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  FileText, Search, BookOpen, TrendingUp, AlertTriangle,
} from "lucide-react";
import { useAcademicRegistrar } from "../../context";

interface Student {
  id: string; name: string; admissionNumber: string; email: string;
  course?: { name: string; code: string }; department?: { name: string };
}

interface StudentPoints {
  attendancePct: number | null;
}

interface UnitAttendanceRow {
  unitCode: string;
  unitTitle: string;
  attended: number;
  total: number;
  pct: number;
}

interface PointsResponse {
  points: StudentPoints | null;
  enrolledUnitCodes: string[];
  unitAttendance: UnitAttendanceRow[];
}

function TranscriptCard({ student }: { student: Student }) {
  const [points, setPoints] = useState<StudentPoints | null>(null);
  const [breakdown, setBreakdown] = useState<UnitAttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const d = await fetch(`/api/students/${student.id}/points`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as PointsResponse;
      setPoints(d.points ?? null);
      setBreakdown(d.unitAttendance ?? []);
      setLoading(false);
    })();
  }, [student.id]);

  const pct = points?.attendancePct ?? null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-violet-500/20 bg-white border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between p-5 bg-gradient-to-r from-violet-900/30 to-slate-900/50">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/20 text-violet-700 text-xl font-bold">
            {student.name[0]?.toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-gray-800 text-lg leading-tight">{student.name}</div>
            <div className="text-sm text-gray-500">{student.admissionNumber}</div>
            <div className="text-xs text-gray-400 mt-0.5">{student.course?.name ?? ""} · {student.department?.name ?? ""}</div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${pct !== null ? (pct >= 75 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-rose-600") : "text-gray-500"}`}>
            {pct !== null ? `${Math.round(pct)}%` : "—"}
          </div>
          <div className="text-xs text-gray-400">Attendance</div>
        </div>
      </div>

      {/* Unit breakdown */}
      <div className="p-4">
        <h3 className="text-xs font-semibold text-gray-500 mb-3 flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5 text-violet-600" /> Unit Breakdown
        </h3>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-8 rounded-lg bg-gray-200 animate-pulse" />)}</div>
        ) : breakdown.length === 0 ? (
          <p className="text-xs text-gray-500 py-2">No attendance data for enrolled units.</p>
        ) : (
          <div className="space-y-2">
            {breakdown.map(u => (
              <div key={u.unitCode} className="flex items-center gap-3">
                <div className="w-28 shrink-0">
                  <span className="font-mono text-xs text-violet-700 block">{u.unitCode}</span>
                  {u.unitTitle && <span className="text-xs text-gray-400 truncate block max-w-full">{u.unitTitle}</span>}
                </div>
                <div className="flex-1 h-1.5 rounded-full bg-gray-200">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${u.pct}%`, backgroundColor: u.pct >= 75 ? "#34d399" : u.pct >= 50 ? "#f59e0b" : "#f87171" }} />
                </div>
                <span className={`text-xs font-medium w-10 text-right shrink-0 ${u.pct >= 75 ? "text-emerald-600" : u.pct >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                  {u.pct}%
                </span>
                <span className="text-xs text-gray-500">{u.attended}/{u.total}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function TranscriptsPage() {
  const admin = useAcademicRegistrar();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Student | null>(null);

  const load = useCallback(async () => {
    if (!admin?.institutionId) return;
    setLoading(true);
    const s = await fetch(`/api/students?institutionId=${admin.institutionId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any;
    setStudents(s.students ?? s.data ?? s ?? []);
    setLoading(false);
  }, [admin?.institutionId]);

  useEffect(() => { load(); }, [load]);

  const q = search.toLowerCase();
  const filtered = students.filter(s =>
    !q || s.name.toLowerCase().includes(q) || s.admissionNumber.toLowerCase().includes(q)
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          <FileText className="h-5 w-5 text-violet-600" /> Transcripts
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Search a student to view their academic transcript</p>
      </div>

      {!selected ? (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or admission number…"
              className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50" />
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="space-y-px">
                {[...Array(8)].map((_, i) => <div key={i} className="h-14 bg-gray-200 border-b border-gray-100 animate-pulse" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12">
                <AlertTriangle className="h-7 w-7 text-slate-700" />
                <p className="text-gray-400">{search ? "No students match your search" : "No students yet"}</p>
              </div>
            ) : filtered.map(s => (
              <button key={s.id} onClick={() => setSelected(s)}
                className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-gray-200/50 hover:bg-gray-50 text-left last:border-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-violet-600 text-xs font-bold">
                  {s.name[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{s.name}</div>
                  <div className="text-xs text-gray-400">{s.admissionNumber} · {s.course?.name ?? ""}</div>
                </div>
                <TrendingUp className="h-4 w-4 text-slate-700 shrink-0" />
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <button onClick={() => setSelected(null)}
            className="flex items-center gap-1.5 text-sm text-violet-600 hover:text-violet-700">
            ← Back to student list
          </button>
          <TranscriptCard student={selected} />
        </div>
      )}
    </div>
  );
}
