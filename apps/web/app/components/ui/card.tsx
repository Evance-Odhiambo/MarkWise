import { forwardRef, HTMLAttributes } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CardTheme = "light" | "dark";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  theme?: CardTheme;
  /** Remove default padding from the card root */
  noPad?: boolean;
}

// ─── Card (container) ─────────────────────────────────────────────────────────

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { theme = "light", noPad = false, className = "", children, ...props },
  ref,
) {
  const base =
    theme === "dark"
      ? "rounded-2xl border border-slate-700 bg-slate-800 shadow-2xl shadow-black/40"
      : "rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/30";

  return (
    <div
      ref={ref}
      className={[base, noPad ? "" : "p-6", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </div>
  );
});

Card.displayName = "Card";

// ─── CardHeader ────────────────────────────────────────────────────────────────

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className = "", children, ...props }, ref) {
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

CardHeader.displayName = "CardHeader";

// ─── CardTitle ─────────────────────────────────────────────────────────────────

function CardTitle({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={[
        "text-xl font-bold tracking-tight text-slate-900 dark:text-white",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </h3>
  );
}

// ─── CardDescription ───────────────────────────────────────────────────────────

function CardDescription({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={[
        "text-sm text-slate-500 dark:text-slate-400 leading-relaxed",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </p>
  );
}

// ─── CardContent ────────────────────────────────────────────────────────────────

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className = "", children, ...props }, ref) {
    return (
      <div ref={ref} className={["pt-4", className].filter(Boolean).join(" ")} {...props}>
        {children}
      </div>
    );
  },
);

CardContent.displayName = "CardContent";

// ─── CardFooter ─────────────────────────────────────────────────────────────────

const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className = "", children, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={[
          "flex items-center pt-4 border-t border-slate-100 dark:border-slate-800",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {children}
      </div>
    );
  },
);

CardFooter.displayName = "CardFooter";

// ─── CardDivider ───────────────────────────────────────────────────────────────

function CardDivider({ className = "", ...props }: HTMLAttributes<HTMLHRElement>) {
  return (
    <hr
      className={[
        "border-slate-100 dark:border-slate-800 my-4",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardDivider,
};
export default Card;
