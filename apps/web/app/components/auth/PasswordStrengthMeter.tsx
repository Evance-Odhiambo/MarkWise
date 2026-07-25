"use client";

const LABELS      = ["Too short", "Weak", "Fair", "Good", "Strong", "Very strong"];
const BAR_COLORS  = ["bg-red-500", "bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-emerald-500", "bg-emerald-500"];
const TEXT_COLORS = ["text-red-400", "text-red-400", "text-orange-400", "text-yellow-400", "text-emerald-400", "text-emerald-400"];

/** Returns a strength score 0‒5 based on length, uppercase, lowercase, digit, special char. */
export function strengthScore(pwd: string): number {
  let s = 0;
  if (pwd.length >= 8)          s++;
  if (/[A-Z]/.test(pwd))        s++;
  if (/[a-z]/.test(pwd))        s++;
  if (/[0-9]/.test(pwd))        s++;
  if (/[^A-Za-z0-9]/.test(pwd)) s++;
  return s;
}

interface PasswordStrengthMeterProps {
  password: string;
}

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  if (!password) return null;
  const score = strengthScore(password);
  const checks: [boolean, string][] = [
    [password.length >= 8,          "8+ characters"],
    [/[A-Z]/.test(password),        "Uppercase"],
    [/[a-z]/.test(password),        "Lowercase"],
    [/[0-9]/.test(password),        "Number"],
    [/[^A-Za-z0-9]/.test(password), "Special char"],
  ];

  return (
    <div className="mt-2 space-y-1.5">
      {/* Bar segments */}
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
              i <= score ? BAR_COLORS[score] : "bg-slate-700"
            }`}
          />
        ))}
      </div>

      {/* Label + score */}
      <div className="flex items-center justify-between">
        <span className={`text-xs font-medium ${TEXT_COLORS[score]}`}>{LABELS[score]}</span>
        <span className="text-xs text-slate-600">{score}/5</span>
      </div>

      {/* Checklist */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        {checks.map(([ok, label], i) => (
          <span key={i} className={`flex items-center gap-1 ${ok ? "text-emerald-400" : "text-slate-600"}`}>
            <span>{ok ? "✓" : "○"}</span>{label}
          </span>
        ))}
      </div>
    </div>
  );
}
