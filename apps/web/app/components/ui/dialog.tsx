"use client";

import { useEffect, HTMLAttributes, forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Max width class, e.g. "max-w-lg" */
  maxWidth?: string;
}

// ─── Dialog (root) ─────────────────────────────────────────────────────────────

function Dialog({ open, onClose, children, maxWidth = "max-w-lg" }: DialogProps) {
  // Lock body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            aria-hidden="true"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: "spring", damping: 24, stiffness: 300 }}
            className={[
              "fixed left-1/2 top-1/2 z-50",
              "-translate-x-1/2 -translate-y-1/2",
              "w-full",
              maxWidth,
              "rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl shadow-black/20",
            ].join(" ")}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── DialogHeader ─────────────────────────────────────────────────────────────

function DialogHeader({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["mb-5 flex flex-col gap-1", className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

// ─── DialogTitle ──────────────────────────────────────────────────────────────

function DialogTitle({ className = "", children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={[
        "text-lg font-bold text-gray-900 tracking-tight",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </h2>
  );
}

// ─── DialogDescription ──────────────────────────────────────────────────────────

function DialogDescription({ className = "", children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={[
        "text-sm text-gray-500 leading-relaxed",
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

// ─── DialogFooter ─────────────────────────────────────────────────────────────

function DialogFooter({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[
        "flex items-center justify-end gap-3 pt-5 mt-5 border-t border-gray-200",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </div>
  );
}

// ─── DialogClose ──────────────────────────────────────────────────────────────

interface DialogCloseProps {
  onClose: () => void;
  className?: string;
}

function DialogClose({ onClose, className = "" }: DialogCloseProps) {
  return (
    <button
      onClick={onClose}
      aria-label="Close dialog"
      className={[
        "absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg",
        "text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-150",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

export { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose };
export default Dialog;
