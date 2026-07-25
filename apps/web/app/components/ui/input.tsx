"use client";

import { forwardRef, InputHTMLAttributes, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type InputTheme = "light" | "dark";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  theme?: InputTheme;
  error?: boolean;
  /** Icon rendered on the left inside the input */
  leftIcon?: React.ReactNode;
  /** Icon rendered on the right inside the input (overridden by password toggle) */
  rightIcon?: React.ReactNode;
}

// ─── Eye icons ───────────────────────────────────────────────────────────────

function EyeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    theme = "light",
    error = false,
    leftIcon,
    rightIcon,
    type,
    className = "",
    ...props
  },
  ref,
) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const resolvedType = isPassword ? (showPassword ? "text" : "password") : type;

  // Theme-aware base classes
  const base =
    theme === "dark"
      ? "bg-slate-900 border-slate-700 text-white placeholder-slate-500 focus:border-violet-400 focus:ring-violet-400/20"
      : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:border-indigo-400 focus:ring-indigo-400/20";

  const errorClass = error ? "border-red-500 focus:border-red-400 focus:ring-red-400/20" : "";

  const inputClasses = [
    "w-full rounded-xl border px-3.5 py-2.5 text-sm",
    "outline-none focus:ring-2 transition-all duration-150",
    leftIcon  ? "pl-10" : "",
    isPassword || rightIcon ? "pr-11" : "",
    base,
    errorClass,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="relative w-full">
      {/* Left icon slot */}
      {leftIcon && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
          {leftIcon}
        </span>
      )}

      <input
        ref={ref}
        type={resolvedType}
        className={inputClasses}
        {...props}
      />

      {/* Password toggle (takes priority over rightIcon) */}
      {isPassword ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? "Hide password" : "Show password"}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300 transition-colors"
        >
          {showPassword ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      ) : rightIcon ? (
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
          {rightIcon}
        </span>
      ) : null}
    </div>
  );
});

Input.displayName = "Input";

export { Input };
export default Input;
