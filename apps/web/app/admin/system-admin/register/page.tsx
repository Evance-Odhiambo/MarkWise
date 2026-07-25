"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Card } from "@/app/components/ui/card";
import { Label } from "@/app/components/ui/label";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { FormField, AlertBanner } from "@/app/components/ui/form";

export default function SystemAdminRegisterPage() {
  const router = useRouter();

  // Step 1: form fields; Step 2: success
  const [step, setStep] = useState<1 | 2>(1);

  // Form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Institution fields
  const [institutionName, setInstitutionName] = useState("");

  // Campus fields
  const [campusName, setCampusName] = useState("");
  const [campusLocation, setCampusLocation] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState("");

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

    if (!institutionName.trim()) {
      setError("Please enter an institution name.");
      return;
    }
    if (!campusName.trim()) {
      setError("Please enter a campus name.");
      return;
    }

    const body = {
      fullName,
      email,
      password,
      role: "system_admin",
      institutionName: institutionName.trim(),
      campusName: campusName.trim(),
      campusLocation: campusLocation.trim(),
    };

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
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-violet-950 to-indigo-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-violet-300 bg-clip-text text-transparent">
            MarkWise
          </span>
        </div>

        {/* ── Step 1: Registration Form ─────────────────────────────────────── */}
        {step === 1 && (
          <Card theme="dark" noPad className="p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold text-white tracking-tight">
                System Administrator Registration
              </h1>
              <p className="text-sm text-slate-400 mt-2">
                Onboard and manage an entire institution — departments, staff & settings.
              </p>
            </div>

            <form className="space-y-5" onSubmit={onSubmit}>
              {/* Personal info */}
              <div className="space-y-4">
                <h2 className="text-base font-semibold text-white">Personal Information</h2>
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
                      placeholder="Dr. Jane Smith"
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
                      placeholder="admin@institution.edu"
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

              {/* Institution Setup */}
              <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-indigo-300 flex items-center gap-2">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                    </svg>
                    Institution Setup
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Create your institution profile. This will be the foundation for all departments and users.
                  </p>
                </div>
                
                <FormField>
                  <Label htmlFor="reg-institution-name" theme="dark">Institution Name *</Label>
                  <Input
                    id="reg-institution-name"
                    type="text"
                    theme="dark"
                    required
                    value={institutionName}
                    onChange={(e) => setInstitutionName(e.target.value)}
                    placeholder="e.g., University of Lagos"
                  />
                </FormField>
              </div>

              {/* Campus Setup */}
              <div className="rounded-xl border border-violet-500/40 bg-violet-500/10 p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-violet-300 flex items-center gap-2">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Campus Setup
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Create your first campus. You can add more campuses later from your dashboard.
                  </p>
                </div>
                
                <FormField>
                  <Label htmlFor="reg-campus-name" theme="dark">Campus Name *</Label>
                  <Input
                    id="reg-campus-name"
                    type="text"
                    theme="dark"
                    required
                    value={campusName}
                    onChange={(e) => setCampusName(e.target.value)}
                    placeholder="e.g., Main Campus"
                  />
                </FormField>

                <FormField>
                  <Label htmlFor="reg-campus-location" theme="dark">Campus Location (Optional)</Label>
                  <Input
                    id="reg-campus-location"
                    type="text"
                    theme="dark"
                    value={campusLocation}
                    onChange={(e) => setCampusLocation(e.target.value)}
                    placeholder="e.g., Akoka, Lagos"
                  />
                </FormField>
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
              >
                Create System Administrator Account
              </Button>

              <p className="text-sm text-slate-400 text-center">
                Already have an account?{" "}
                <Link href="/admin/system-admin/login" className="font-bold text-violet-300 hover:text-violet-200 hover:underline transition-colors">
                  Sign in here
                </Link>
              </p>
            </form>
          </Card>
        )}

        {/* ── Step 2: Success ───────────────────────────────────────────────── */}
        {step === 2 && (
          <Card theme="dark" noPad className="p-8 flex flex-col items-center gap-6">
            <div className="flex items-center justify-center h-16 w-16 rounded-full bg-green-500/15 border border-green-500/30">
              <svg className="h-8 w-8 text-green-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-extrabold text-white tracking-tight">Account Created!</h2>
              <p className="text-sm text-slate-400 mt-2">
                Your <span className="font-semibold text-violet-300">System Administrator</span> account for{" "}
                <span className="font-semibold text-white">{registeredEmail}</span> has been created.
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => router.push("/admin/system-admin/login")}
            >
              Sign In to Your Portal
            </Button>
          </Card>
        )}

        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-slate-400 hover:text-slate-200 transition-colors inline-flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to MarkWise Home
          </Link>
        </div>
      </div>
    </main>
  );
}
