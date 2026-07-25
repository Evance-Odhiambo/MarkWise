"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Card } from "@/app/components/ui/card";
import { Label } from "@/app/components/ui/label";
import { Input } from "@/app/components/ui/input";
import { Button } from "@/app/components/ui/button";
import { FormField, AlertBanner } from "@/app/components/ui/form";
import { CalendarDays, ArrowLeft } from "lucide-react";

export default function FacilitiesManagerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    setSuccess(false);

    try {
      const response = await fetch("/api/auth/admin/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role: "facilities_manager" }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        admin?: { id: string; fullName: string; email: string; role: string };
      };

      if (!response.ok || !payload.success || !payload.admin) {
        setError(payload.error ?? "Invalid credentials for Facilities Manager portal.");
        return;
      }

      setSuccess(true);
      setTimeout(() => router.push("/admin/facilities-manager"), 800);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-sky-950/40 to-slate-950 flex flex-col justify-between py-10 px-4">
      {/* Top Section */}
      <div className="w-full max-w-md mx-auto">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-200 transition-colors inline-flex items-center gap-1.5 mb-8">
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>
      </div>

      <div className="w-full max-w-md mx-auto my-auto">
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

        <Card theme="dark" noPad className="p-8 border border-sky-500/20 bg-slate-900/60 backdrop-blur-md shadow-2xl">
          {/* Header */}
          <div className="flex flex-col items-center gap-3 mb-6">
            <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 shadow-lg shadow-sky-500/5">
              <CalendarDays className="h-7 w-7" />
            </div>
            <div className="text-center">
              <h1 className="text-2xl font-extrabold text-white tracking-tight">Facilities Manager</h1>
              <p className="text-sm text-slate-400 mt-1">
                Sign in to your dedicated facilities portal
              </p>
            </div>
          </div>

          {/* Success Banner */}
          {success && (
            <div className="mb-4">
              <AlertBanner intent="success">
                Signed in successfully. Accessing dashboard…
              </AlertBanner>
            </div>
          )}

          <form className="space-y-5" onSubmit={onSubmit}>
            {/* Email */}
            <FormField>
              <Label htmlFor="admin-email" theme="dark">Email Address</Label>
              <Input
                id="admin-email"
                type="email"
                theme="dark"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="facilities@institution.edu"
              />
            </FormField>

            {/* Password */}
            <FormField>
              <Label htmlFor="admin-password" theme="dark">Password</Label>
              <Input
                id="admin-password"
                type="password"
                theme="dark"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </FormField>

            {/* Error */}
            {error && <AlertBanner intent="error">{error}</AlertBanner>}

            {/* Submit */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              disabled={loading || success}
              className="mt-1 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 border-none"
            >
              Sign In to Facilities Portal
            </Button>
          </form>

          {/* Footer links */}
          <div className="mt-6 flex flex-col items-center gap-3">
            <Link
              href="/admin/forgot-password"
              className="text-sm text-slate-400 hover:text-sky-400 transition-colors"
            >
              Forgot your password?
            </Link>
            <p className="text-sm text-slate-400">
              Don&apos;t have an account?{" "}
              <Link
                href="/admin/facilities-manager/register"
                className="font-bold text-sky-400 hover:text-sky-300 hover:underline transition-colors"
              >
                Register here
              </Link>
            </p>
          </div>
        </Card>
      </div>

      <div className="w-full text-center text-xs text-slate-500 mt-8">
        &copy; {new Date().getFullYear()} MarkWise. All rights reserved.
      </div>
    </main>
  );
}
