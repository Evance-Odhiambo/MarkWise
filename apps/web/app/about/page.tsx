// app/about/page.tsx
"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";
import type { Variants } from "framer-motion";
import {
  Sparkles, Target, Users, Lightbulb, ShieldCheck,
  GraduationCap, Building2, BarChart3, ArrowRight,
} from "lucide-react";
import AppHeader from "@/app/components/AppHeader";
import AppFooter from "@/app/components/AppFooter";

// ─── Data ────────────────────────────────────────────────────────────────────

const VALUES = [
  {
    icon: ShieldCheck,
    title: "Trust & Integrity",
    desc: "We build every feature on a foundation of honest data and tamper-evident records so institutions can rely on what they see.",
    color: "from-indigo-500 to-blue-500",
    bg: "bg-indigo-50 dark:bg-indigo-500/10",
  },
  {
    icon: Lightbulb,
    title: "Innovation",
    desc: "We combine BLE proximity detection, session-based check-ins, and real-time sync to bring campuses true, modern verification.",
    color: "from-amber-500 to-yellow-400",
    bg: "bg-amber-50 dark:bg-amber-500/10",
  },
  {
    icon: Users,
    title: "Inclusivity",
    desc: "Every role — student, lecturer, department head, registrar — has a purposely designed, accessible experience.",
    color: "from-purple-500 to-violet-500",
    bg: "bg-purple-50 dark:bg-purple-500/10",
  },
  {
    icon: Target,
    title: "Outcomes",
    desc: "We measure success by institutional outcomes: fewer attendance disputes, faster room allocation, and better student engagement.",
    color: "from-emerald-500 to-teal-500",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
  },
];

const TEAM = [
  { name: "Evan Kamau",     role: "Founder & CEO",        initials: "EK", color: "from-indigo-600 to-cyan-500"   },
  { name: "Aisha Omondi",   role: "Head of Product",       initials: "AO", color: "from-purple-600 to-pink-500"   },
  { name: "James Mutua",    role: "Lead Engineer",         initials: "JM", color: "from-emerald-600 to-teal-500"  },
  { name: "Fatuma Hassan",  role: "Customer Success Lead", initials: "FH", color: "from-amber-500 to-orange-500"  },
];

const MILESTONES = [
  { year: "2023", event: "MarkWise founded with a vision to fix broken campus attendance across East Africa." },
  { year: "2024 Q1", event: "First pilot launched with 3 institutions covering 2,400 active students." },
  { year: "2024 Q3", event: "BLE proximity verification shipped — industry-first fraud-resistant check-in." },
  { year: "2025", event: "Expanded to room bookings, timetable coordination, and assignment management." },
  { year: "2026", event: "Platform live across 18 institutions. Building toward regional expansion." },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AboutPage() {
  const heroRef       = useRef(null);
  const missionRef    = useRef(null);
  const valuesRef     = useRef(null);
  const timelineRef   = useRef(null);
  const teamRef       = useRef(null);
  const ctaRef        = useRef(null);

  const heroInView     = useInView(heroRef,     { once: true, amount: 0.3 });
  const missionInView  = useInView(missionRef,  { once: true, amount: 0.2 });
  const valuesInView   = useInView(valuesRef,   { once: true, amount: 0.1 });
  const timelineInView = useInView(timelineRef, { once: true, amount: 0.1 });
  const teamInView     = useInView(teamRef,     { once: true, amount: 0.1 });
  const ctaInView      = useInView(ctaRef,      { once: true, amount: 0.4 });

  const fadeUp: Variants = {
    hidden:  { opacity: 0, y: 28 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0, 0, 0.2, 1] } },
  };
  const stagger: Variants = {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 overflow-x-hidden">
      {/* Ambient blobs */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-4 w-72 h-72 bg-indigo-300 rounded-full mix-blend-multiply filter blur-3xl opacity-40 dark:opacity-20 animate-blob" />
        <div className="absolute top-20 -right-4 w-72 h-72 bg-cyan-300 rounded-full mix-blend-multiply filter blur-3xl opacity-40 dark:opacity-20 animate-blob animation-delay-2000" />
        <div className="absolute -bottom-8 left-40 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl opacity-40 dark:opacity-20 animate-blob animation-delay-4000" />
      </div>

      <AppHeader />

      {/* ── Hero ── */}
      <section ref={heroRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center">
        <motion.div variants={stagger} initial="hidden" animate={heroInView ? "visible" : "hidden"} className="space-y-6 max-w-3xl mx-auto">
          <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30">
            <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Our Story</span>
          </motion.div>
          <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 dark:text-white">
            Built for{" "}
            <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
              Africa&apos;s Campuses
            </span>
          </motion.h1>
          <motion.p variants={fadeUp} className="text-lg sm:text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed">
            MarkWise was born in a Nairobi lecture hall where attendance fraud was routine and room scheduling was done on spreadsheets. We decided to change that — for every institution.
          </motion.p>
        </motion.div>
      </section>

      {/* ── Mission ── */}
      <section ref={missionRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={missionInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center"
        >
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <Target className="h-4 w-4 text-indigo-500" />
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Mission</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white leading-tight">
              Replacing guesswork with verified institutional intelligence
            </h2>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Our mission is to give every higher-education institution — regardless of size or budget — the tools to run a reliable, fraud-resistant, and transparent campus. We believe administrators should spend their time on strategy, not chasing attendance sheets.
            </p>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              From BLE-based proximity checks to real-time timetable coordination and tamper-evident audit logs, every feature in MarkWise is designed to reduce friction and increase trust between students, staff, and leadership.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: GraduationCap, label: "18+ Institutions",    sub: "and growing across East Africa",   color: "text-indigo-600 dark:text-indigo-400" },
              { icon: Users,         label: "50,000+ Students",     sub: "active on the platform today",     color: "text-purple-600 dark:text-purple-400" },
              { icon: Building2,     label: "200+ Departments",     sub: "using MarkWise daily",             color: "text-cyan-600 dark:text-cyan-400"    },
              { icon: BarChart3,     label: "99.7% Uptime",         sub: "in production environments",       color: "text-emerald-600 dark:text-emerald-400" },
            ].map((s) => (
              <div key={s.label} className="p-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60">
                <s.icon className={`h-6 w-6 mb-3 ${s.color}`} />
                <div className="text-xl font-bold text-slate-900 dark:text-white">{s.label}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{s.sub}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ── Values ── */}
      <section ref={valuesRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <motion.div variants={stagger} initial="hidden" animate={valuesInView ? "visible" : "hidden"} className="space-y-12">
          <motion.div variants={fadeUp} className="text-center space-y-3 max-w-2xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white">What we stand for</h2>
            <p className="text-slate-600 dark:text-slate-300">Four principles that guide every product decision we make.</p>
          </motion.div>
          <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {VALUES.map((v) => (
              <motion.div key={v.title} variants={fadeUp} className="p-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 space-y-4">
                <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${v.color} flex items-center justify-center shadow`}>
                  <v.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white">{v.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{v.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* ── Timeline ── */}
      <section ref={timelineRef} className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-16">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={timelineInView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.6 }} className="space-y-10">
          <div className="text-center space-y-3">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white">Our journey</h2>
            <p className="text-slate-600 dark:text-slate-300">From a single campus problem to a multi-institution platform.</p>
          </div>
          <div className="relative">
            <div className="absolute left-6 top-0 h-full w-0.5 bg-gradient-to-b from-indigo-500 via-purple-500 to-cyan-500 opacity-30" />
            <div className="space-y-8">
              {MILESTONES.map((m, i) => (
                <motion.div
                  key={m.year}
                  initial={{ opacity: 0, x: -20 }}
                  animate={timelineInView ? { opacity: 1, x: 0 } : {}}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="relative pl-16"
                >
                  <div className="absolute left-0 top-1 h-12 w-12 rounded-full bg-gradient-to-br from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                    <span className="text-[10px] font-bold text-white text-center leading-tight px-1">{m.year}</span>
                  </div>
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60">
                    <p className="text-slate-700 dark:text-slate-200 leading-relaxed">{m.event}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── Team ── */}
      <section ref={teamRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
        <motion.div variants={stagger} initial="hidden" animate={teamInView ? "visible" : "hidden"} className="space-y-12">
          <motion.div variants={fadeUp} className="text-center space-y-3 max-w-2xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white">The team behind MarkWise</h2>
            <p className="text-slate-600 dark:text-slate-300">A small, mission-driven team with deep roots in African higher education.</p>
          </motion.div>
          <motion.div variants={stagger} className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {TEAM.map((t) => (
              <motion.div key={t.name} variants={fadeUp} className="flex flex-col items-center gap-4 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 text-center">
                <div className={`h-16 w-16 rounded-2xl bg-gradient-to-br ${t.color} flex items-center justify-center shadow-lg text-white text-xl font-bold`}>
                  {t.initials}
                </div>
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">{t.name}</div>
                  <div className="text-sm text-slate-500 dark:text-slate-400">{t.role}</div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* ── CTA ── */}
      <section ref={ctaRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={ctaInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.6 }}
          className="relative rounded-3xl overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600" />
          <div className="relative z-10 px-8 py-16 text-center text-white space-y-6">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Ready to transform your campus?</h2>
            <p className="text-indigo-100 max-w-xl mx-auto">Join the institutions already running a more reliable, transparent, and fraud-resistant campus with MarkWise.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/admin/system-admin/register" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-white text-indigo-700 font-bold hover:bg-indigo-50 transition-colors shadow-lg">
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/contact" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl border-2 border-white/50 text-white font-semibold hover:bg-white/10 transition-colors">
                Contact Us
              </Link>
            </div>
          </div>
        </motion.div>
      </section>

      <AppFooter />
    </div>
  );
}
