import { forwardRef, ButtonHTMLAttributes } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ButtonVariant =
  | "primary"      // indigo → violet gradient  (dark portals)
  | "secondary"    // bordered slate            (dark portals)
  | "accent"       // indigo → cyan gradient    (light pages)
  | "ghost"        // transparent hover         (any context)
  | "outline"      // border only               (any context)
  | "destructive"  // red                       (danger actions)
  | "success";     // green                     (confirm actions)

export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

// ─── Class maps ───────────────────────────────────────────────────────────────

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20 " +
    "hover:from-violet-700 hover:to-indigo-700 focus-visible:ring-violet-400",
  secondary:
    "bg-slate-700 border border-slate-600 text-slate-100 " +
    "hover:bg-slate-600 focus-visible:ring-slate-400",
  accent:
    "bg-gradient-to-r from-indigo-600 to-cyan-500 text-white shadow-md shadow-indigo-500/25 " +
    "hover:from-indigo-700 hover:to-cyan-600 focus-visible:ring-indigo-400",
  ghost:
    "bg-transparent text-slate-300 hover:bg-white/8 hover:text-white focus-visible:ring-slate-400",
  outline:
    "bg-transparent border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 " +
    "hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:ring-indigo-400",
  destructive:
    "bg-red-600 text-white shadow-md shadow-red-500/20 " +
    "hover:bg-red-700 focus-visible:ring-red-400",
  success:
    "bg-emerald-600 text-white shadow-md shadow-emerald-500/20 " +
    "hover:bg-emerald-700 focus-visible:ring-emerald-400",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs:   "h-7 px-3 text-xs gap-1.5 rounded-lg",
  sm:   "h-8 px-3.5 text-sm gap-1.5 rounded-lg",
  md:   "h-10 px-4 text-sm gap-2 rounded-xl",
  lg:   "h-11 px-6 text-base gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-xl",
};

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12" cy="12" r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    leftIcon,
    rightIcon,
    fullWidth = false,
    disabled,
    className = "",
    children,
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={[
        // Base
        "inline-flex items-center justify-center font-semibold",
        "transition-all duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "disabled:opacity-60 disabled:cursor-not-allowed disabled:pointer-events-none",
        // Variant
        VARIANT_CLASSES[variant],
        // Size
        SIZE_CLASSES[size],
        // Width
        fullWidth ? "w-full" : "",
        // Custom
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {loading ? <Spinner /> : leftIcon}
      {children && <span>{children}</span>}
      {!loading && rightIcon}
    </button>
  );
});

Button.displayName = "Button";

export { Button };
export default Button;
