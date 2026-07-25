// app/pricing/page.tsx
"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";
import type { Variants } from "framer-motion";
import {
  CheckCircle,
  Building2,
  Users,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Calendar,
  Layers,
  BarChart3,
  MessageSquare,
  RefreshCw,
  HelpCircle,
  ChevronDown,
  Calculator,
} from "lucide-react";
import AppHeader from "@/app/components/AppHeader";
import AppFooter from "@/app/components/AppFooter";

// ─── Constants ───────────────────────────────────────────────────────────────

const PRICE_PER_STUDENT = 199;
const INCLUDED_FEATURES = [
  { icon: CheckCircle,   label: "Verified Attendance Sessions",       desc: "Session-based check-ins with fraud-resistant presence confirmation" },
  { icon: Calendar,      label: "Timetable & Room Coordination",      desc: "Real-time room availability, booking visibility, and conflict detection" },
  { icon: Layers,        label: "Assignment Management",              desc: "Centralized creation, timestamped submissions, and version tracking" },
  { icon: Users,         label: "Study Group Workflows",              desc: "Balanced group setup, controlled enrollment, and group submission" },
  { icon: MessageSquare, label: "Learning Material Sharing",          desc: "Trusted update channel for lecture notes, resources, and announcements" },
  { icon: BarChart3,     label: "Analytics & Reports",                desc: "Attendance trends, room utilization, and academic performance insights" },
  { icon: RefreshCw,     label: "Hybrid & Online Support",            desc: "Physical, online, and hybrid session modes with engagement check-ins" },
  { icon: ShieldCheck,   label: "Compliance & Audit Records",         desc: "Tamper-evident records ready for institutional governance and review" },
];

const FAQS = [
  {
    q: "Who pays for MarkWise — the institution or the students?",
    a: "MarkWise is licensed exclusively to institutions. There is no charge passed on to students. Each institution pays a single annual or semester-based campus license, and all enrolled students, lecturers, and administrators are covered.",
  },
  {
    q: "What counts as an 'active student'?",
    a: "An active student is any student who has been enrolled in at least one unit for the given academic semester. Students who are on leave, deferred, or not registered for units in a semester are not counted.",
  },
  {
    q: "Is pricing per semester or per year?",
    a: "The base rate of KSh 199 is per student per semester. Institutions with two semesters per year are billed KSh 398 per active student annually. We also offer annual upfront billing with a discount.",
  },
  {
    q: "Can different departments or campuses use the platform independently?",
    a: "Yes. MarkWise supports multi-department and multi-campus configurations under a single institution account. Administrators at each level — institution, department, and faculty — have role-scoped access.",
  },
  {
    q: "Is there a free trial or pilot period?",
    a: "We offer a guided pilot program for qualifying institutions. Reach out to our team and we can configure a limited deployment so your team can evaluate the platform before committing to full licensing.",
  },
  {
    q: "What does onboarding and implementation include?",
    a: "Onboarding covers platform configuration, data migration support, staff training workshops, and a dedicated rollout coordinator. One-time implementation fees are quoted separately based on institution size and complexity.",
  },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left bg-white dark:bg-slate-900/60 hover:bg-indigo-50 dark:hover:bg-indigo-500/5 transition-colors"
      >
        <span className="font-semibold text-slate-900 dark:text-white">{q}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-indigo-500 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="px-6 pb-5 pt-2 text-slate-600 dark:text-slate-300 leading-relaxed bg-white dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800">
          {a}
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const heroRef       = useRef(null);
  const modelRef      = useRef(null);
  const featuresRef   = useRef(null);
  const faqRef        = useRef(null);
  const ctaRef        = useRef(null);

  const heroInView     = useInView(heroRef,     { once: true, amount: 0.3 });
  const modelInView    = useInView(modelRef,    { once: true, amount: 0.2 });
  const featuresInView = useInView(featuresRef, { once: true, amount: 0.1 });
  const faqInView      = useInView(faqRef,      { once: true, amount: 0.2 });
  const ctaInView      = useInView(ctaRef,      { once: true, amount: 0.4 });

  const fadeUp: Variants = {
    hidden:  { opacity: 0, y: 28 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0, 0, 0.2, 1] } },
  };

  const stagger: Variants = {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 overflow-x-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-4 w-72 h-72 bg-indigo-300 rounded-full mix-blend-multiply filter blur-3xl opacity-40 dark:opacity-20 animate-blob" />
        <div className="absolute top-20 -right-4 w-72 h-72 bg-cyan-300 rounded-full mix-blend-multiply filter blur-3xl opacity-40 dark:opacity-20 animate-blob animation-delay-2000" />
        <div className="absolute -bottom-8 left-40 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl opacity-40 dark:opacity-20 animate-blob animation-delay-4000" />
      </div>

      <AppHeader />

      {/* ── Hero ── */}
      <section
        ref={heroRef}
        className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-16 pb-12 text-center"
      >
        <motion.div
          variants={stagger}
          initial="hidden"
          animate={heroInView ? "visible" : "hidden"}
          className="space-y-6 max-w-3xl mx-auto"
        >
          <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30">
            <Calculator className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
              Transparent, Institution-Wide Licensing
            </span>
          </motion.div>

          <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 dark:text-white">
            Simple Pricing for{" "}
            <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
              Every Institution
            </span>
          </motion.h1>

          <motion.p variants={fadeUp} className="text-lg sm:text-xl text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
            One flat rate per active student per semester. No per-module fees, no per-lecturer seats,
            no hidden charges. Your entire institution is covered.
          </motion.p>

          {/* Hero price card */}
          <motion.div
            variants={fadeUp}
            className="inline-flex flex-col items-center gap-1 px-10 py-8 mt-4 rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-cyan-600 shadow-2xl text-white"
          >
            <span className="text-sm font-semibold uppercase tracking-widest opacity-80">Single Rate</span>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-6xl sm:text-7xl font-extrabold tracking-tight">199</span>
              <div className="mb-2 text-left">
                <div className="text-xl font-bold">KSh</div>
                <div className="text-sm opacity-80">per student</div>
                <div className="text-sm opacity-80">per semester</div>
              </div>
            </div>
            <span className="mt-2 text-sm opacity-75">Billed per active enrolled student each semester</span>
          </motion.div>
        </motion.div>
      </section>

      {/* ── Business Model ── */}
      <section
        ref={modelRef}
        className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-20"
      >
        <motion.div
          variants={stagger}
          initial="hidden"
          animate={modelInView ? "visible" : "hidden"}
          className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center"
        >
          <motion.div variants={fadeUp} className="space-y-6">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 text-sm font-medium">
              <Building2 className="h-4 w-4" />
              B2B SaaS Model
            </span>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white">
              Institutions Pay.
              <br />
              <span className="bg-gradient-to-r from-indigo-600 to-cyan-600 bg-clip-text text-transparent">
                Everyone Benefits.
              </span>
            </h2>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              MarkWise is sold directly to universities, colleges, and tertiary institutions —
              not to individual students or lecturers. The institution holds the license and
              all its users — students, lecturers, and administrators — access the platform
              as part of their academic environment at no personal cost.
            </p>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              Pricing scales naturally with your institution. Smaller colleges pay less.
              Larger universities pay more. But the rate per student never changes,
              making budgeting predictable and procurement straightforward.
            </p>
            <Link
              href="/admin/system-admin/register"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 text-white font-semibold hover:shadow-lg hover:scale-105 transition-all duration-300"
            >
              Register Your Institution
              <ArrowRight className="h-5 w-5" />
            </Link>
          </motion.div>

          {/* Key points */}
          <motion.div variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { icon: Building2,  title: "Institution License",    desc: "One account for your entire campus — all departments included" },
              { icon: Users,      title: "Unlimited Admins",       desc: "Institution, department, faculty, and registry admins at no extra cost" },
              { icon: RefreshCw,  title: "Per-Semester Billing",   desc: "Pay only for active enrolled students each semester, nothing more" },
              { icon: ShieldCheck,title: "Full Platform Access",   desc: "Every feature — attendance, rooms, assignments, groups — is included" },
            ].map((item) => (
              <motion.div
                key={item.title}
                variants={fadeUp}
                className="p-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-colors"
              >
                <div className="h-10 w-10 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center mb-3">
                  <item.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <h3 className="font-bold text-slate-900 dark:text-white mb-1">{item.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">{item.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

      {/* ── What's Included ── */}
      <section
        ref={featuresRef}
        className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-20"
      >
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={featuresInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-14 space-y-3"
        >
          <span className="inline-block px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 text-sm font-medium">
            Everything Included
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white">
            One Price. The Full Platform.
          </h2>
          <p className="max-w-2xl mx-auto text-slate-600 dark:text-slate-300">
            Every capability below is available to all users at your institution from day one.
            There are no add-on modules or feature tiers.
          </p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          animate={featuresInView ? "visible" : "hidden"}
          className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5"
        >
          {INCLUDED_FEATURES.map((f) => (
            <motion.div
              key={f.label}
              variants={fadeUp}
              className="group p-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:shadow-lg transition-all duration-300"
            >
              <div className="h-11 w-11 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <f.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <h3 className="font-bold text-slate-900 dark:text-white mb-2">{f.label}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{f.desc}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Compare note */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={featuresInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3 p-5 rounded-2xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30"
        >
          <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400 shrink-0" />
          <p className="text-sm text-green-800 dark:text-green-300 font-medium text-center sm:text-left">
            All features are available to every institution on every plan — no feature-gating, no upgrade prompts.
          </p>
        </motion.div>
      </section>

      {/* ── FAQ ── */}
      <section
        ref={faqRef}
        className="mx-auto w-full max-w-3xl px-4 sm:px-6 lg:px-8 py-16 lg:py-20"
      >
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={faqInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12 space-y-3"
        >
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 text-sm font-medium">
            <HelpCircle className="h-4 w-4" />
            Frequently Asked Questions
          </span>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white">Common Pricing Questions</h2>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          animate={faqInView ? "visible" : "hidden"}
          className="space-y-3"
        >
          {FAQS.map((faq) => (
            <motion.div key={faq.q} variants={fadeUp}>
              <FaqItem q={faq.q} a={faq.a} />
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── CTA ── */}
      <section
        ref={ctaRef}
        className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={ctaInView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.6 }}
          className="relative rounded-3xl overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600">
            <div className="absolute inset-0 bg-grid-white/10" />
          </div>
          <div className="absolute top-0 -left-4 w-24 h-24 bg-white rounded-full opacity-10 animate-pulse" />
          <div className="absolute bottom-0 -right-4 w-32 h-32 bg-white rounded-full opacity-10 animate-pulse animation-delay-2000" />

          <div className="relative z-10 px-8 py-16 lg:py-24 text-center text-white">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={ctaInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 border border-white/25 text-sm font-medium mb-6"
            >
              <Sparkles className="h-4 w-4" />
              Start Your Pilot
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={ctaInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6"
            >
              Ready to Get Started?
            </motion.h2>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={ctaInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="text-lg sm:text-xl mb-10 max-w-xl mx-auto opacity-90"
            >
              Register your institution today and configure your campus in minutes.
              Pricing scales exactly with your enrollment — no surprises.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={ctaInView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex flex-col sm:flex-row justify-center gap-4"
            >
              <Link
                href="/admin/system-admin/register"
                className="group px-8 py-4 bg-white text-indigo-600 rounded-2xl font-semibold text-lg hover:shadow-2xl transition-all duration-300 hover:scale-105 flex items-center justify-center gap-2"
              >
                Register Institution
                <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="/admin/system-admin/login"
                className="group px-8 py-4 bg-transparent border-2 border-white text-white rounded-2xl font-semibold text-lg hover:bg-white/10 transition-all duration-300 hover:scale-105 flex items-center justify-center gap-2"
              >
                Sign In
                <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </motion.div>
          </div>
        </motion.div>
      </section>

      <AppFooter />
    </div>
  );
}
