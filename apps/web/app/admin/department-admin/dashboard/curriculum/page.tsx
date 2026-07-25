"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDepartmentAdmin } from "../../context";

type Unit = { id: string; title: string; code: string; courseId?: string };
type Semester = { id: string; label: string; units: Unit[] };
type YearBlock = { id: string; name: string; semesters: Semester[] };
type Program = { id: string; name: string; durationYears: number; years: YearBlock[] };

type ModalState =
  | { type: "add-program" }
  | { type: "delete-program"; programId: string }
  | { type: "add-unit"; programId: string; yearId: string; semesterId: string }
  | { type: "bulk-units"; programId: string; yearId: string; semesterId: string }
  | { type: "delete-unit"; programId: string; yearId: string; semesterId: string; unitId: string };

async function saveCurriculum(programs: Program[], departmentId: string) {
  const res = await fetch("/api/curriculum", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ departmentId, programs }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? "Failed to save curriculum");
  }
  return res.json();
}

export default function DeptCurriculumPage() {
  const admin = useDepartmentAdmin();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [openPrograms, setOpenPrograms] = useState<string[]>([]);
  const [openYears, setOpenYears] = useState<string[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [programName, setProgramName] = useState("");
  const [programDuration, setProgramDuration] = useState("4");
  const [unitTitle, setUnitTitle] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [bulkUnitCsv, setBulkUnitCsv] = useState("");

  useEffect(() => {
    if (!admin?.departmentId) return;
    setIsLoading(true);
    fetch(`/api/curriculum?departmentId=${admin.departmentId}`)
      .then(r => r.ok ? r.json() : {})
      .then((data: any) => {
        const sorted = (data.programs ?? []).sort((a: Program, b: Program) => a.name.localeCompare(b.name));
        setPrograms(sorted);
        setOpenPrograms(sorted.map((p: Program) => p.id));
        setOpenYears(sorted.flatMap((p: Program) => p.years.map((y: YearBlock) => `${p.id}-${y.id}`)));
      })
      .catch(err => setAuthError(err.message ?? "Failed to load curriculum"))
      .finally(() => setIsLoading(false));
  }, [admin?.departmentId]);

  const savePrograms = async (newPrograms: Program[]) => {
    setPrograms(newPrograms);
    if (!admin?.departmentId || isSaving) return;
    setIsSaving(true);
    setSaveStatus("Saving…");
    try {
      await saveCurriculum(newPrograms, admin.departmentId);
      setSaveStatus("Saved!");
      setTimeout(() => setSaveStatus(""), 2000);
    } catch (err: any) {
      setSaveStatus(err.message ?? "Save failed");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!admin?.departmentId) return;
    setSaveStatus("Saving…");
    try {
      await saveCurriculum(programs, admin.departmentId);
      setSaveStatus("Saved!");
      setTimeout(() => setSaveStatus(""), 2000);
    } catch (err: any) {
      setSaveStatus(err.message ?? "Save failed");
    }
  };

  const stats = useMemo(() => ({
    programs: programs.length,
    units: programs.reduce((s, p) => s + p.years.reduce((s2, y) => s2 + y.semesters.reduce((s3, sm) => s3 + sm.units.length, 0), 0), 0),
  }), [programs]);

  // ── Mutation helpers ────────────────────────────────────────────────────────
  const addProgram = () => {
    if (!programName.trim()) return;
    const id = crypto.randomUUID();
    const newProg: Program = {
      id, name: programName.trim(), durationYears: Number(programDuration),
      years: Array.from({ length: Number(programDuration) }, (_, i) => ({
        id: crypto.randomUUID(), name: `Year ${i + 1}`,
        semesters: [
          { id: crypto.randomUUID(), label: "Semester 1", units: [] },
          { id: crypto.randomUUID(), label: "Semester 2", units: [] },
        ],
      })),
    };
    const newPrograms = [...programs, newProg].sort((a, b) => a.name.localeCompare(b.name));
    savePrograms(newPrograms);
    setOpenPrograms(prev => [...prev, id]);
    setProgramName(""); setProgramDuration("4");
    setModal(null);
  };

  const deleteProgram = (programId: string) => {
    savePrograms(programs.filter(p => p.id !== programId));
    setModal(null);
  };

  const addUnit = (programId: string, yearId: string, semesterId: string) => {
    if (!unitCode.trim() || !unitTitle.trim()) return;
    const newUnit: Unit = { id: crypto.randomUUID(), code: unitCode.trim().toUpperCase(), title: unitTitle.trim() };
    const newPrograms = programs.map(p => p.id !== programId ? p : {
      ...p, years: p.years.map(y => y.id !== yearId ? y : {
        ...y, semesters: y.semesters.map(sm => sm.id !== semesterId ? sm : {
          ...sm, units: [...sm.units, newUnit],
        }),
      }),
    });
    savePrograms(newPrograms);
    setUnitCode(""); setUnitTitle("");
    setModal(null);
  };

  const parseBulkUnits = (csv: string): Unit[] =>
    csv.trim().split("\n")
      .map(l => l.trim()).filter(Boolean)
      .map(row => {
        const commaIdx = row.indexOf(",");
        if (commaIdx === -1) return null;
        const code = row.slice(0, commaIdx).trim().toUpperCase();
        const title = row.slice(commaIdx + 1).trim();
        if (!code || !title) return null;
        return { id: crypto.randomUUID(), code, title };
      })
      .filter((u): u is Unit => u !== null);

  const addBulkUnits = (programId: string, yearId: string, semesterId: string) => {
    const newUnits = parseBulkUnits(bulkUnitCsv);
    if (!newUnits.length) return;
    const newPrograms = programs.map(p => p.id !== programId ? p : {
      ...p, years: p.years.map(y => y.id !== yearId ? y : {
        ...y, semesters: y.semesters.map(sm => sm.id !== semesterId ? sm : {
          ...sm, units: [...sm.units, ...newUnits],
        }),
      }),
    });
    savePrograms(newPrograms);
    setBulkUnitCsv("");
    setModal(null);
  };

  const deleteUnit = (programId: string, yearId: string, semesterId: string, unitId: string) => {
    const newPrograms = programs.map(p => p.id !== programId ? p : {
      ...p, years: p.years.map(y => y.id !== yearId ? y : {
        ...y, semesters: y.semesters.map(sm => sm.id !== semesterId ? sm : {
          ...sm, units: sm.units.filter(u => u.id !== unitId),
        }),
      }),
    });
    savePrograms(newPrograms);
    setModal(null);
  };

  const inp = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500/50";

  if (isLoading) return (
    <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-16 rounded-2xl bg-gray-100 animate-pulse" />)}</div>
  );
  if (authError) return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">{authError}</div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Curriculum</h1>
          <p className="text-sm text-gray-400 mt-0.5">{stats.programs} programs · {stats.units} units · {admin?.departmentName}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setModal({ type: "add-program" })}
            className="rounded-xl bg-teal-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-teal-700">+ Program</button>
          <button onClick={handleSave}
            className="rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-700">
            {saveStatus || "Save Changes"}
          </button>
        </div>
      </div>

      {programs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 rounded-2xl border border-gray-200 bg-white">
          <p className="text-sm text-gray-500">No programs yet. Add one to get started.</p>
        </div>
      ) : programs.map(prog => {
        const isOpen = openPrograms.includes(prog.id);
        return (
          <div key={prog.id} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-4 cursor-pointer hover:bg-gray-50"
              onClick={() => setOpenPrograms(prev => isOpen ? prev.filter(id => id !== prog.id) : [...prev, prog.id])}>
              <div className="flex-1">
                <div className="text-sm font-semibold text-gray-900">{prog.name}</div>
                <div className="text-xs text-gray-400">{prog.durationYears} year{prog.durationYears !== 1 ? "s" : ""}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); setModal({ type: "delete-program", programId: prog.id }); }}
                className="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded">Delete</button>
              <span className="text-gray-400">{isOpen ? "▲" : "▼"}</span>
            </div>
            {isOpen && (
              <div className="border-t border-gray-100">
                {prog.years.map(year => {
                  const yearKey = `${prog.id}-${year.id}`;
                  const yearOpen = openYears.includes(yearKey);
                  return (
                    <div key={year.id}>
                      <div className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 cursor-pointer border-b border-gray-100"
                        onClick={() => setOpenYears(prev => yearOpen ? prev.filter(k => k !== yearKey) : [...prev, yearKey])}>
                        <span className="text-xs font-semibold text-gray-600">{year.name}</span>
                        <span className="text-gray-400 ml-auto">{yearOpen ? "▲" : "▼"}</span>
                      </div>
                      {yearOpen && year.semesters.map(sem => (
                        <div key={sem.id} className="px-5 py-3 border-b border-gray-50 last:border-0">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-gray-500">{sem.label}</span>
                            <div className="flex gap-2">
                              <button onClick={() => { setBulkUnitCsv(""); setModal({ type: "bulk-units", programId: prog.id, yearId: year.id, semesterId: sem.id }); }}
                                className="text-xs text-sky-600 hover:text-sky-700">Bulk Import</button>
                              <button onClick={() => { setUnitCode(""); setUnitTitle(""); setModal({ type: "add-unit", programId: prog.id, yearId: year.id, semesterId: sem.id }); }}
                                className="text-xs text-teal-600 hover:text-teal-700">+ Unit</button>
                            </div>
                          </div>
                          {sem.units.length === 0 ? (
                            <p className="text-xs text-gray-400 pl-2">No units yet</p>
                          ) : sem.units.map(unit => (
                            <div key={unit.id} className="flex items-center gap-2 py-1">
                              <span className="font-mono text-xs text-gray-500 w-20 shrink-0">{unit.code}</span>
                              <span className="text-sm text-gray-700 flex-1 truncate">{unit.title}</span>
                              <button onClick={() => deleteUnit(prog.id, year.id, sem.id, unit.id)}
                                className="text-xs text-red-400 hover:text-red-500">×</button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Modals — rendered via portal to escape overflow-hidden/transform containment */}
      {typeof window !== "undefined" && modal && createPortal(
        <>
          {modal.type === "add-program" && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="w-full max-w-sm rounded-2xl bg-white text-gray-900 p-6 shadow-2xl">
                <h3 className="text-base font-bold text-gray-800 mb-4">Add Program</h3>
                <div className="space-y-3">
                  <input value={programName} onChange={e => setProgramName(e.target.value)} placeholder="Program name" className={inp} />
                  <select value={programDuration} onChange={e => setProgramDuration(e.target.value)} className={inp}>
                    {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} year{n !== 1 ? "s" : ""}</option>)}
                  </select>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setModal(null)} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
                    <button onClick={addProgram} className="flex-1 rounded-xl bg-teal-600 py-2 text-sm font-medium text-white hover:bg-teal-700">Add</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {modal.type === "add-unit" && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="w-full max-w-sm rounded-2xl bg-white text-gray-900 p-6 shadow-2xl">
                <h3 className="text-base font-bold text-gray-800 mb-4">Add Unit</h3>
                <div className="space-y-3">
                  <input value={unitCode} onChange={e => setUnitCode(e.target.value)} placeholder="Unit code (e.g. CS401)" className={inp} />
                  <input value={unitTitle} onChange={e => setUnitTitle(e.target.value)} placeholder="Unit title" className={inp} />
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setModal(null)} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
                    <button onClick={() => addUnit((modal as any).programId, (modal as any).yearId, (modal as any).semesterId)}
                      className="flex-1 rounded-xl bg-teal-600 py-2 text-sm font-medium text-white hover:bg-teal-700">Add Unit</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {modal.type === "bulk-units" && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="w-full max-w-lg rounded-2xl bg-white text-gray-900 p-6 shadow-2xl">
                <h3 className="text-base font-bold text-gray-800 mb-1">Bulk Import Units</h3>
                <p className="text-xs text-gray-400 mb-3">
                  One unit per line: <span className="font-mono text-gray-500">UnitCode, Unit Title</span>
                </p>
                <textarea
                  value={bulkUnitCsv}
                  onChange={e => setBulkUnitCsv(e.target.value)}
                  rows={9}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-mono text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/50 mb-1"
                  placeholder={"CS401, Data Structures and Algorithms\nCS402, Database Design\nCS403, Operating Systems\nCS404, Software Engineering"}
                />
                <p className="text-xs text-gray-400 mb-3">
                  {parseBulkUnits(bulkUnitCsv).length} valid unit{parseBulkUnits(bulkUnitCsv).length !== 1 ? "s" : ""} detected
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setModal(null)} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
                  <button
                    onClick={() => addBulkUnits((modal as any).programId, (modal as any).yearId, (modal as any).semesterId)}
                    disabled={parseBulkUnits(bulkUnitCsv).length === 0}
                    className="flex-1 rounded-xl bg-teal-600 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50">
                    Import {parseBulkUnits(bulkUnitCsv).length} Unit{parseBulkUnits(bulkUnitCsv).length !== 1 ? "s" : ""}
                  </button>
                </div>
              </div>
            </div>
          )}

          {modal.type === "delete-program" && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="w-full max-w-sm rounded-2xl bg-white text-gray-900 p-6 shadow-2xl">
                <h3 className="text-base font-bold text-gray-800 mb-2">Delete Program?</h3>
                <p className="text-sm text-gray-500 mb-4">This will remove the program and all its units from the curriculum.</p>
                <div className="flex gap-2">
                  <button onClick={() => setModal(null)} className="flex-1 rounded-xl border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50">Cancel</button>
                  <button onClick={() => deleteProgram((modal as any).programId)}
                    className="flex-1 rounded-xl bg-red-500 py-2 text-sm font-medium text-white hover:bg-red-600">Delete</button>
                </div>
              </div>
            </div>
          )}
        </>,
        document.body
      )}
    </div>
  );
}
