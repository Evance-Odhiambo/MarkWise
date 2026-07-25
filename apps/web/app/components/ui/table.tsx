import { forwardRef, HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

// ─── Table (scroll wrapper + table) ───────────────────────────────────────────

const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  function Table({ className = "", children, ...props }, ref) {
    return (
      <div className="w-full overflow-x-auto">
        <table
          ref={ref}
          className={["w-full text-sm text-left", className].filter(Boolean).join(" ")}
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },
);

Table.displayName = "Table";

// ─── TableCaption ─────────────────────────────────────────────────────────────

function TableCaption({ className = "", children, ...props }: HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption
      className={["mb-3 px-1 text-left text-xs text-slate-400 dark:text-slate-500", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </caption>
  );
}

// ─── TableHeader ─────────────────────────────────────────────────────────────

const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableHeader({ className = "", children, ...props }, ref) {
    return (
      <thead
        ref={ref}
        className={[
          "border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {children}
      </thead>
    );
  },
);

TableHeader.displayName = "TableHeader";

// ─── TableBody ────────────────────────────────────────────────────────────────

const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableBody({ className = "", children, ...props }, ref) {
    return (
      <tbody
        ref={ref}
        className={["divide-y divide-slate-100 dark:divide-slate-800", className]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {children}
      </tbody>
    );
  },
);

TableBody.displayName = "TableBody";

// ─── TableFooter ─────────────────────────────────────────────────────────────

const TableFooter = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  function TableFooter({ className = "", children, ...props }, ref) {
    return (
      <tfoot
        ref={ref}
        className={[
          "border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 font-medium",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {children}
      </tfoot>
    );
  },
);

TableFooter.displayName = "TableFooter";

// ─── TableRow ─────────────────────────────────────────────────────────────────

const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  function TableRow({ className = "", children, ...props }, ref) {
    return (
      <tr
        ref={ref}
        className={[
          "transition-colors duration-100 hover:bg-slate-50 dark:hover:bg-slate-800/40",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {children}
      </tr>
    );
  },
);

TableRow.displayName = "TableRow";

// ─── TableHead ───────────────────────────────────────────────────────────────

const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  function TableHead({ className = "", children, ...props }, ref) {
    return (
      <th
        ref={ref}
        scope="col"
        className={[
          "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {children}
      </th>
    );
  },
);

TableHead.displayName = "TableHead";

// ─── TableCell ───────────────────────────────────────────────────────────────

const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  function TableCell({ className = "", children, ...props }, ref) {
    return (
      <td
        ref={ref}
        className={[
          "px-4 py-3 text-slate-700 dark:text-slate-300",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...props}
      >
        {children}
      </td>
    );
  },
);

TableCell.displayName = "TableCell";

// ─── Badge (inline status pill, useful in table cells) ───────────────────────

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "muted";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const BADGE_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  danger:  "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  info:    "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  muted:   "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

function Badge({ variant = "default", className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        BADGE_CLASSES[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}

export {
  Table,
  TableCaption,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  Badge,
};
export default Table;
