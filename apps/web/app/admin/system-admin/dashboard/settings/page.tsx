"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Settings2, User, Lock, LogOut, Eye, EyeOff, CheckCircle2, Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useSystemAdmin } from "../../context";

const inp = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500";
const lbl = "block text-xs font-medium text-gray-500 mb-1.5";

export default function SettingsPage() {
  const admin = useSystemAdmin();
  const router = useRouter();

  const [fullName, setFullName] = useState(admin?.fullName ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileOk, setProfileOk] = useState(false);
  const [profileErr, setProfileErr] = useState("");

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });
  const [savingPw, setSavingPw] = useState(false);
  const [pwOk, setPwOk] = useState(false);
  const [pwErr, setPwErr] = useState("");

  const saveProfile = async () => {
    if (!fullName.trim()) { setProfileErr("Name is required."); return; }
    setSavingProfile(true); setProfileErr(""); setProfileOk(false);
    const r = await fetch("/api/auth/me", {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullName }),
    });
    if (r.ok) { setProfileOk(true); setTimeout(() => setProfileOk(false), 3000); }
    else { const j = await r.json(); setProfileErr(j.error ?? "Failed to update profile."); }
    setSavingProfile(false);
  };

  const changePw = async () => {
    if (!pw.current || !pw.next || !pw.confirm) { setPwErr("All fields are required."); return; }
    if (pw.next !== pw.confirm) { setPwErr("New passwords do not match."); return; }
    if (pw.next.length < 8) { setPwErr("New password must be at least 8 characters."); return; }
    setSavingPw(true); setPwErr(""); setPwOk(false);
    const r = await fetch("/api/auth/change-password", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next }),
    });
    if (r.ok) {
      setPwOk(true);
      setPw({ current: "", next: "", confirm: "" });
      setTimeout(() => setPwOk(false), 3000);
    } else {
      const j = await r.json();
      setPwErr(j.error ?? "Failed to change password.");
    }
    setSavingPw(false);
  };

  const signOut = async () => {
    await fetch("/api/auth/admin/logout", { method: "POST", credentials: "include" });
    window.location.href = "/admin/system-admin/login";
  };

  const Section = ({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) => (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5"
    >
      <div className="flex items-center gap-2.5 mb-5 pb-4 border-b border-gray-200">
        <Icon className="h-4 w-4 text-indigo-600" />
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      </div>
      {children}
    </motion.div>
  );

  return (
    <div className="space-y-5 max-w-xl">
      <h1 className="text-xl font-bold text-gray-800">Settings</h1>

      {/* Institution Info */}
      <Section icon={Settings2} title="Institution">
        <div className="space-y-3">
          <div>
            <label className={lbl}>Institution Name</label>
            <input className={`${inp} opacity-60 cursor-not-allowed`} value={admin?.institutionName ?? ""} readOnly />
          </div>
          <div>
            <label className={lbl}>Your Role</label>
            <input className={`${inp} opacity-60 cursor-not-allowed`} value={admin?.role ?? ""} readOnly />
          </div>
        </div>
      </Section>

      {/* Profile */}
      <Section icon={User} title="Profile">
        <div className="space-y-4">
          <div>
            <label className={lbl}>Full Name</label>
            <input
              className={inp}
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Your full name"
            />
          </div>
          <div>
            <label className={lbl}>Email Address</label>
            <input className={`${inp} opacity-60 cursor-not-allowed`} value={admin?.email ?? ""} readOnly />
          </div>
          {profileErr && <p className="text-xs text-red-600">{profileErr}</p>}
          {profileOk && (
            <motion.p
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex items-center gap-1.5 text-xs text-emerald-600"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Profile updated.
            </motion.p>
          )}
          <button
            onClick={saveProfile}
            disabled={savingProfile}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-sm font-medium text-white transition-colors"
          >
            {savingProfile && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {savingProfile ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </Section>

      {/* Password */}
      <Section icon={Lock} title="Change Password">
        <div className="space-y-4">
          {(["current", "next", "confirm"] as const).map((key) => {
            const labels = { current: "Current Password", next: "New Password", confirm: "Confirm New Password" };
            return (
              <div key={key}>
                <label className={lbl}>{labels[key]}</label>
                <div className="relative">
                  <input
                    className={inp}
                    type={showPw[key] ? "text" : "password"}
                    placeholder={key === "next" || key === "confirm" ? "Min. 8 characters" : ""}
                    value={pw[key]}
                    onChange={e => setPw(p => ({ ...p, [key]: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(p => ({ ...p, [key]: !p[key] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                  >
                    {showPw[key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            );
          })}
          {pwErr && <p className="text-xs text-red-600">{pwErr}</p>}
          {pwOk && (
            <motion.p
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex items-center gap-1.5 text-xs text-emerald-600"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Password changed successfully.
            </motion.p>
          )}
          <button
            onClick={changePw}
            disabled={savingPw}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-4 py-2.5 text-sm font-medium text-white transition-colors"
          >
            {savingPw && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {savingPw ? "Updating..." : "Update Password"}
          </button>
        </div>
      </Section>

      {/* Sign Out */}
      <Section icon={LogOut} title="Session">
        <div className="space-y-2">
          <p className="text-sm text-gray-500">Sign out of your institution admin account on this device.</p>
          <button
            onClick={signOut}
            className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </Section>
    </div>
  );
}
