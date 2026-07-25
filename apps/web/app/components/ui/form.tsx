import { HTMLAttributes, forwardRef } from "react";
import type { LabelTheme } from "./label";

// ─── FormField ──────────────────────────────────────────────────────────────────

/** Vertical stack that groups a label, control and error/description */
const FormField = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function FormField({ className = "", children, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={["flex flex-col gap-1.5", className].filter(Boolean).join(" ")}
        {...props}
      >
        {children}
      </div>
    );
  },
);

FormField.displayName = "FormField";

// ─── FormLabel ──────────────────────────────────────────────────────────────────

import { Label } from "./label";
export { Label as FormLabel };

// ─── FormMessage ────────────────────────────────────────────────────────────────

interface FormMessageProps extends HTMLAttributes<HTMLParagraphElement> {
  /** When true renders as an error (red); otherwise muted */
  error?: boolean;
}

function FormMessage({ error = true, className = "", children, ...props }: FormMessageProps) {
  if (!children) return null;
  return (
    <p
      role={error ? "alert" : undefined}
      className={[
        "flex items-center gap-1.5 text-xs font-medium",
        error ? "text-red-400" : "text-slate-400",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {error && (
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
      {children}
    </p>
  );
}

// ─── FormDescription ────────────────────────────────────────────────────────────

function FormDescription({ className = "", children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={["text-xs text-slate-400 dark:text-slate-500", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </p>
  );
}

// ─── AlertBanner ──────────────────────────────────────────────────────────────

type AlertIntent = "error" | "success" | "info" | "warning";

interface AlertBannerProps {
  intent?: AlertIntent;
  children: React.ReactNode;
  className?: string;
}

const ALERT_STYLES: Record<AlertIntent, { wrap: string; icon: React.ReactNode }> = {
  error: {
    wrap: "bg-red-500/10 border-red-500/25 text-red-300",
    icon: (
      <svg className="h-4 w-4 text-red-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  success: {
    wrap: "bg-green-500/10 border-green-500/25 text-green-300",
    icon: (
      <svg className="h-4 w-4 text-green-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  info: {
    wrap: "bg-indigo-500/10 border-indigo-500/25 text-indigo-300",
    icon: (
      <svg className="h-4 w-4 text-indigo-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  warning: {
    wrap: "bg-amber-500/10 border-amber-500/25 text-amber-300",
    icon: (
      <svg className="h-4 w-4 text-amber-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
};

function AlertBanner({ intent = "error", className = "", children }: AlertBannerProps) {
  const { wrap, icon } = ALERT_STYLES[intent];
  return (
    <div
      role={intent === "error" ? "alert" : undefined}
      className={[
        "flex items-start gap-3 rounded-xl border px-4 py-3",
        wrap,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="mt-0.5">{icon}</span>
      <p className="text-sm font-medium leading-snug">{children}</p>
    </div>
  );
}

export { FormField, FormMessage, FormDescription, AlertBanner };
