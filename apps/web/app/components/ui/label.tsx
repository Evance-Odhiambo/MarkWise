import { forwardRef, LabelHTMLAttributes } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LabelTheme = "light" | "dark";

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
  theme?: LabelTheme;
  /** Treat this as an error label */
  error?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

const Label = forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { theme = "light", required = false, error = false, className = "", children, ...props },
  ref,
) {
  const colorClass = error
    ? "text-red-500 dark:text-red-400"
    : theme === "dark"
      ? "text-slate-200"
      : "text-slate-700 dark:text-slate-200";

  return (
    <label
      ref={ref}
      className={[
        "block text-sm font-semibold leading-none select-none",
        colorClass,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
      {required && (
        <span className="ml-0.5 text-red-500" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );
});

Label.displayName = "Label";

export { Label };
export default Label;
