"use client";
import { Eye, EyeOff } from "lucide-react";
import type { AuthAccent } from "./AuthCard";

const FOCUS_CLASSES: Record<AuthAccent, string> = {
  indigo:  "focus:ring-indigo-500/50 focus:border-indigo-500",
  emerald: "focus:ring-emerald-500/50 focus:border-emerald-500",
  blue:    "focus:ring-blue-500/50 focus:border-blue-500",
};

interface PasswordInputProps {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  accent: AuthAccent;
  placeholder?: string;
  autoComplete?: string;
  extraClass?: string;
  required?: boolean;
}

export function PasswordInput({
  id,
  value,
  onChange,
  show,
  onToggle,
  accent,
  placeholder = "••••••••",
  autoComplete = "current-password",
  extraClass = "",
  required = false,
}: PasswordInputProps) {
  const base =
    "w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2.5 pr-10 text-sm text-slate-100 " +
    "placeholder-slate-500 focus:outline-none focus:ring-2 transition-colors " +
    FOCUS_CLASSES[accent];

  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${base} ${extraClass}`}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
