"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Card } from "@/app/components/ui/card";
import { Label } from "@/app/components/ui/label";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { FormField, AlertBanner } from "@/app/components/ui/form";
import { LayoutDashboard, ArrowLeft } from "lucide-react";

export default function DepartmentAdminRegisterPage() {
  const router = useRouter();

  // Steps: 1 = form, 2 = success
  const [step, setStep] = useState<1 | 2>(1);

  // Form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Institution selection
  const [institutionId, setInstitutionId] = useState("");
  const [institutionSearch, setInstitutionSearch] = useState("");
  const [institutions, setInstitutions] = useState<{ id: string; name: string }[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);
  const [institutionDropdownOpen, setInstitutionDropdownOpen] = useState(false);
  const institutionInputRef = useRef<HTMLInputElement>(null);

  // Campus selection
  const [campusId, setCampusId] = useState("");
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [campusesLoading, setCampusesLoading] = useState(false);

  // Department selection
  const [createDepartment, setCreateDepartment] = useState(false);
  const [departmentId, setDepartmentId] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");

  // Fetch institutions on mount
  useEffect(() => {
    setInstitutionsLoading(true);
    fetch("/api/institutions")
      .then((r) => r.json())
      .then((data) => {
        setInstitutions(Array.isArray(data) ? data : (data.data ?? []));
      })
      .catch(() => setInstitutions([]))
      .finally(() => setInstitutionsLoading(false));
  }, []);

  // Fetch campuses when institutionId changes
  useEffect(() => {
    if (!institutionId) {
      setCampuses([]);
      setCampusId("");
      return;
    }
    setCampusesLoading(true);
    setCampusId("");
    fetch(`/api/institution/${institutionId}/campuses`)
      .then((r) => r.json())
      .then((data) => {
        setCampuses(Array.isArray(data) ? data : (data.campuses ?? data.data ?? []));
      })
      .catch(() => setCampuses([]))
      .finally(() => setCampusesLoading(false));
  }, [institutionId]);

  // Fetch departments when institutionId changes
  useEffect(() => {
    if (!institutionId) {
      setDepartments([]);
      setDepartmentId("");
      setDepartmentName("");
      return;
    }
    setDepartmentsLoading(true);
    setDepartmentId("");
    setDepartmentName("");
    fetch(`/api/departments?institutionId=${institutionId}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: any) => {
        setDepartments(data.departments ?? data.data ?? data ?? []);
      })
      .catch(() => setDepartments([]))
      .finally(() => setDepartmentsLoading(false));
  }, [institutionId]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (!institutionId) {
      setError("Please select an institution.");
      return;
    }
    if (!campusId) {
      setError("Please select a campus.");
      return;
    }

    if (createDepartment && !departmentName.trim()) {
      setError("Please enter a department name.");
      return;
    }
    if (!createDepartment && !departmentId) {
      setError("Please select a department or choose to create a new one.");
      return;
    }

    const body: Record<string, string> = {
      fullName,
      email,
      password,
      role: "department_admin",
      institutionId,
      campusId,
    };

    if (createDepartment) {
      body.departmentName = departmentName.trim();
    } else {
      body.departmentId = departmentId;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/admin/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        admin?: { id: string; email: string; role: string };
      };

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Registration failed. Please try again.");
        return;
      }

      setRegisteredEmail(payload.admin?.email ?? email);
      setStep(2);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-emerald-950/40 to-slate-950 flex flex-col justify-between py-10 px-4">
      {/* Top Section */}
      <div className="w-full max-w-2xl mx-auto">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200 transition-colors inline-flex items-center gap-1.5 mb-8">
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>
      </div>

      <div className="w-full max-w-2xl mx-auto my-auto">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-violet-300 bg-clip-text text-transparent">
            MarkWise
          </span>
        </div>

        {step === 1 ? (
          <Card theme="dark" noPad className="p-8 border border-emerald-500/20 bg-slate-900/60 backdrop-blur-md shadow-2xl">
            <div className="flex flex-col items-center gap-3 mb-6">
              <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-lg shadow-emerald-500/5">
                <LayoutDashboard className="h-7 w-7" />
              </div>
              <div className="text-center">
                <h1 className="text-2xl font-extrabold text-white tracking-tight">Department Admin Signup</h1>
                <p className="text-sm text-slate-400 mt-1">
                  Create your account under your institution, campus, and department
                </p>
              </div>
            </div>

            <form className="space-y-5" onSubmit={onSubmit}>
              {/* Personal Information */}
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-slate-300">Personal Details</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField>
                    <Label htmlFor="reg-fullname" theme="dark">Full Name *</Label>
                    <Input
                      id="reg-fullname"
                      type="text"
                      theme="dark"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Jane Doe"
                    />
                  </FormField>
                  <FormField>
                    <Label htmlFor="reg-email" theme="dark">Email Address *</Label>
                    <Input
                      id="reg-email"
                      type="email"
                      theme="dark"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="deptadmin@institution.edu"
                    />
                  </FormField>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField>
                    <Label htmlFor="reg-password" theme="dark">Password *</Label>
                    <Input
                      id="reg-password"
                      type="password"
                      theme="dark"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                    />
                  </FormField>
                  <FormField>
                    <Label htmlFor="reg-confirm" theme="dark">Confirm Password *</Label>
                    <Input
                      id="reg-confirm"
                      type="password"
                      theme="dark"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                    />
                  </FormField>
                </div>
              </div>

              {/* Institution & Campus Selection */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 space-y-4">
                <h2 className="text-sm font-semibold text-emerald-300 flex items-center gap-2">
                  <LayoutDashboard className="h-4 w-4" />
                  Institution & Campus Selection
                </h2>

                <FormField>
                  <Label htmlFor="reg-inst-search" theme="dark">Select Institution *</Label>
                  <div className="relative">
                    <input
                      id="reg-inst-search"
                      ref={institutionInputRef}
                      type="text"
                      autoComplete="off"
                      required
                      value={institutionSearch}
                      onChange={(e) => {
                        setInstitutionSearch(e.target.value);
                        setInstitutionId("");
                        setInstitutionDropdownOpen(true);
                      }}
                      onFocus={() => setInstitutionDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setInstitutionDropdownOpen(false), 200)}
                      placeholder={institutionsLoading ? "Loading institutions…" : "Search for your institution…"}
                      disabled={institutionsLoading}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-50"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>

                    {institutionDropdownOpen && !institutionsLoading && (
                      <ul className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-slate-700 bg-slate-850 shadow-2xl shadow-black/80">
                        {institutions
                          .filter((inst) =>
                            inst.name.toLowerCase().includes(institutionSearch.toLowerCase())
                          )
                          .map((inst) => (
                            <li key={inst.id}>
                              <button
                                type="button"
                                onMouseDown={() => {
                                  setInstitutionId(inst.id);
                                  setInstitutionSearch(inst.name);
                                  setInstitutionDropdownOpen(false);
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-emerald-500/20 hover:text-emerald-300 transition-colors"
                              >
                                {inst.name}
                              </button>
                            </li>
                          ))}
                        {institutions.filter((inst) =>
                          inst.name.toLowerCase().includes(institutionSearch.toLowerCase())
                        ).length === 0 && (
                          <li className="px-3 py-2 text-sm text-slate-500">No institutions found.</li>
                        )}
                      </ul>
                    )}
                  </div>
                </FormField>

                {/* Campus Dropdown */}
                {institutionId && (
                  <FormField>
                    <Label htmlFor="reg-campus-select" theme="dark">Select Campus *</Label>
                    {campusesLoading ? (
                      <p className="text-xs text-slate-500">Loading campuses…</p>
                    ) : campuses.length === 0 ? (
                      <p className="text-xs text-amber-400">No campuses found. Please contact your system administrator to register campuses first.</p>
                    ) : (
                      <select
                        id="reg-campus-select"
                        value={campusId}
                        onChange={(e) => setCampusId(e.target.value)}
                        required
                        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="">Select campus…</option>
                        {campuses.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </FormField>
                )}

                {/* Department Section */}
                {institutionId && (
                  <div className="space-y-3 pt-3 border-t border-slate-850">
                    <Label theme="dark">Department *</Label>

                    {/* Toggle Switch */}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => { setCreateDepartment(false); setDepartmentName(""); }}
                        className={`flex-1 rounded-lg border px-4 py-2 text-xs font-semibold transition-all ${
                          !createDepartment
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                            : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                        }`}
                      >
                        Join Existing
                      </button>
                      <button
                        type="button"
                        onClick={() => { setCreateDepartment(true); setDepartmentId(""); }}
                        className={`flex-1 rounded-lg border px-4 py-2 text-xs font-semibold transition-all ${
                          createDepartment
                            ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                            : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                        }`}
                      >
                        Create New
                      </button>
                    </div>

                    {!createDepartment ? (
                      <FormField>
                        {departmentsLoading ? (
                          <p className="text-xs text-slate-500">Loading departments…</p>
                        ) : (
                          <select
                            id="reg-dept"
                            value={departmentId}
                            onChange={(e) => {
                              const opt = departments.find(d => d.id === e.target.value);
                              setDepartmentId(e.target.value);
                              setDepartmentName(opt?.name ?? "");
                            }}
                            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                          >
                            <option value="">Select department…</option>
                            {departments.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {departments.length === 0 && !departmentsLoading && (
                          <p className="text-xs text-amber-400 mt-1">No departments found — switch to "Create New" to add one.</p>
                        )}
                      </FormField>
                    ) : (
                      <FormField>
                        <Input
                          type="text"
                          theme="dark"
                          required
                          value={departmentName}
                          onChange={(e) => setDepartmentName(e.target.value)}
                          placeholder="Department name (e.g. Computer Science)"
                        />
                      </FormField>
                    )}
                  </div>
                )}
              </div>

              {/* Error */}
              {error && <AlertBanner intent="error">{error}</AlertBanner>}

              {/* Submit */}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
                className="mt-1 bg-gradient-to-r from-emerald-600 to-teal-600 border-none"
              >
                Create Department Admin Account
              </Button>

              <p className="text-sm text-slate-400 text-center">
                Already have an account?{" "}
                <Link href="/admin/department-admin/login" className="font-bold text-emerald-450 hover:text-emerald-300 hover:underline">
                  Sign in here
                </Link>
              </p>
            </form>
          </Card>
        ) : (
          <Card theme="dark" noPad className="p-8 flex flex-col items-center gap-6 border border-emerald-500/20 bg-slate-900/60 backdrop-blur-md shadow-2xl">
            <div className="flex items-center justify-center h-16 w-16 rounded-full bg-green-500/15 border border-green-500/30">
              <svg className="h-8 w-8 text-green-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-extrabold text-white tracking-tight">Account Created!</h2>
              <p className="text-sm text-slate-400 mt-2">
                Your <span className="font-semibold text-emerald-400">Department Admin</span> account for{" "}
                <span className="font-semibold text-white">{registeredEmail}</span> has been created.
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => router.push("/admin/department-admin/login")}
              className="bg-gradient-to-r from-emerald-600 to-teal-600 border-none"
            >
              Sign In to Your Portal
            </Button>
          </Card>
        )}
      </div>

      <div className="w-full text-center text-xs text-slate-500 mt-8">
        &copy; {new Date().getFullYear()} MarkWise. All rights reserved.
      </div>
    </main>
  );
}
