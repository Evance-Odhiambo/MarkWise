"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Menu, X } from "lucide-react";

export default function AppHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Resolve a section anchor: use /#section when not on the home page
  function sectionHref(anchor: string) {
    return pathname === "/" ? `#${anchor}` : `/#${anchor}`;
  }

  const NAV_LINKS = [
    { label: "Features",         href: sectionHref("features") },
    { label: "How It Works",     href: sectionHref("how-it-works") },
    { label: "Testimonials",     href: sectionHref("testimonials") },
    { label: "Pricing",          href: "/pricing" },
    { label: "For Institutions", href: sectionHref("for-institutions") },
  ];

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-all duration-300 ${
        scrolled
          ? "bg-white/95 dark:bg-slate-950/95 backdrop-blur-md shadow-lg"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="flex items-center gap-2"
        >
          <div className="relative">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-green-500 animate-pulse" />
          </div>
          <span className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-cyan-600 bg-clip-text text-transparent">
            MarkWise
          </span>
        </motion.div>

        {/* Desktop Navigation */}
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((item, i) => (
            <motion.a
              key={item.label}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              href={item.href}
              className="text-sm font-medium text-slate-600 hover:text-indigo-600 dark:text-slate-300 dark:hover:text-indigo-300 transition-colors relative group"
            >
              {item.label}
              <span className="absolute inset-x-0 -bottom-1 h-0.5 bg-gradient-to-r from-indigo-600 to-cyan-600 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left" />
            </motion.a>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="hidden sm:flex items-center gap-3"
          >
            {/* Sign In dropdown */}
            <div className="relative">
              <button
                className="btn-green px-5 py-2 text-sm rounded-xl flex items-center gap-2"
                onClick={() => setDropdownOpen(dropdownOpen === "signin" ? null : "signin")}
              >
                Sign In
                <svg className="inline ml-1 h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {dropdownOpen === "signin" && (
                <div className="absolute right-0 mt-2 w-72 rounded-2xl shadow-2xl border-2 border-indigo-200 dark:border-indigo-600 bg-gradient-to-br from-white via-indigo-50 to-cyan-50 dark:from-slate-900 dark:via-indigo-950 dark:to-cyan-950 z-50 overflow-hidden pl-2">
                  {/* Institutional portals */}
                  <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Admin Portals</p>
                  {[
                    { label: "System Administrator", href: "/admin/system-admin/login", color: "text-indigo-700 dark:text-indigo-300" },
                    { label: "Academic Registrar",   href: "/admin/academic-registrar/login", color: "text-purple-700 dark:text-purple-300" },
                    { label: "Facilities Manager",   href: "/admin/facilities-manager/login", color: "text-orange-700 dark:text-orange-300" },
                    { label: "Department Admin",     href: "/admin/department-admin/login", color: "text-teal-700 dark:text-teal-300" },
                  ].map((item) => (
                    <button
                      key={item.label}
                      className={`flex items-center gap-2 w-full text-left px-4 py-2.5 text-sm font-semibold ${item.color} hover:bg-indigo-100 dark:hover:bg-indigo-800/60 transition-colors duration-150`}
                      onClick={() => { router.push(item.href); setDropdownOpen(null); }}
                    >
                      {item.label}
                    </button>
                  ))}
                  {/* Super admin */}
                  <div className="border-t border-indigo-100 dark:border-indigo-800/60 mt-1 mb-1">
                    <button
                      className="flex items-center gap-2 w-full text-left px-4 py-2.5 text-sm font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors duration-150"
                      onClick={() => { router.push("/admin/super-admin/login"); setDropdownOpen(null); }}
                    >
                      <svg className="h-3.5 w-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
                      </svg>
                      Super Admin
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Get Started */}
            <button
              className="btn-green relative px-6 py-2.5 text-sm rounded-xl font-semibold overflow-hidden"
              onClick={() => { router.push("/admin/system-admin/register"); setDropdownOpen(null); }}
            >
              <span className="relative z-10">Get Started</span>
            </button>
          </motion.div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="md:hidden bg-white dark:bg-slate-950 border-t dark:border-slate-800"
          >
            <div className="px-4 py-4 space-y-3">
              {NAV_LINKS.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="block py-2 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </a>
              ))}
              <div className="pt-4 border-t dark:border-slate-800 flex flex-col gap-3">
                <Link
                  href="/admin/system-admin/login"
                  className="w-full px-4 py-2 text-center text-sm font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Sign In
                </Link>
                <Link
                  href="/admin/system-admin/register"
                  className="w-full px-4 py-2 text-center text-sm font-medium text-white bg-gradient-to-r from-indigo-600 to-cyan-600 rounded-lg"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Get Started
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}