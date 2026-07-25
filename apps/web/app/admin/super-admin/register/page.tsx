"use client";
import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Crown, Eye, EyeOff, ShieldCheck } from "lucide-react";

export default function SuperAdminRegisterPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupSecret, setSetupSecret] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!setupSecret.trim()) {
      setError("Setup secret is required.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/super-admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, password, setupSecret }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error ?? "Failed to create account.");
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push("/admin/super-admin/dashboard"), 1500);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inp =
    "w-full rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-colors";
  const lbl = "block text-xs font-medium text-slate-400 mb-1.5";

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-violet-950/30 to-slate-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500 shadow-lg shadow-violet-500/30">
            <Crown className="h-5 w-5 text-white" />
          </div>
          <span className="text-2xl font-bold text-white tracking-tight">MarkWise</span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/80 backdrop-blur-sm p-8 shadow-2xl">
          <div className="flex flex-col items-center gap-2 mb-7">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-500/15 border border-violet-500/30">
              <ShieldCheck className="h-6 w-6 text-violet-400" />
            </div>
            <h1 className="text-xl font-bold text-slate-100">Create Super Admin</h1>
            <p className="text-xs text-slate-500 text-center">
              This page requires the server setup secret from your{" "}
              <code className="text-violet-400">.env</code> file.
            </p>
          </div>

          {success ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
                <ShieldCheck className="h-6 w-6 text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-emerald-400">Account created! Redirecting…</p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className={lbl}>Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className={inp}
                />
              </div>

              <div>
                <label className={lbl}>Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="admin@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className={inp}
                />
              </div>

              <div>
                <label className={lbl}>Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className={inp + " pr-10"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className={lbl}>Confirm Password</label>
                <input
                  type="password"
                  required
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className={inp}
                />
              </div>

              <div className="pt-1">
                <label className={lbl}>
                  Setup Secret{" "}
                  <span className="text-slate-400 font-normal">
                    (from SUPER_ADMIN_SETUP_SECRET in .env)
                  </span>
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter the server setup secret"
                  value={setupSecret}
                  onChange={e => setSetupSecret(e.target.value)}
                  className={inp}
                />
              </div>

              {error && (
                <p className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-2.5 text-sm text-red-400">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 px-4 py-2.5 text-sm font-semibold text-white transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Creating account…
                  </>
                ) : (
                  "Create Super Admin Account"
                )}
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-xs text-slate-400">
            Already have an account?{" "}
            <Link href="/admin/super-admin/login" className="text-violet-400 hover:text-violet-300">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
