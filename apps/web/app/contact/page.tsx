// app/contact/page.tsx
"use client";

import { useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import type { Variants } from "framer-motion";
import {
  Sparkles, Mail, MapPin, Phone, MessageSquare,
  Clock, Building2, Send, CheckCircle,
} from "lucide-react";
import AppHeader from "@/app/components/AppHeader";
import AppFooter from "@/app/components/AppFooter";

// ─── Data ────────────────────────────────────────────────────────────────────

const CONTACT_CARDS = [
  {
    icon: Mail,
    title: "Email Us",
    detail: "hello@markwise.app",
    sub: "We reply within one business day.",
    color: "from-indigo-500 to-blue-500",
    href: "mailto:hello@markwise.app",
  },
  {
    icon: Phone,
    title: "Call Us",
    detail: "+254 700 000 000",
    sub: "Mon – Fri, 8 am – 6 pm EAT.",
    color: "from-emerald-500 to-teal-500",
    href: "tel:+254700000000",
  },
  {
    icon: MapPin,
    title: "Visit Us",
    detail: "Nairobi, Kenya",
    sub: "Westlands Business Park, 5th Floor.",
    color: "from-purple-500 to-violet-500",
    href: "#",
  },
  {
    icon: Clock,
    title: "Support Hours",
    detail: "Mon – Fri",
    sub: "8:00 am – 6:00 pm East Africa Time.",
    color: "from-amber-500 to-orange-500",
    href: "#",
  },
];

const TOPICS = [
  "General Inquiry",
  "Pricing & Licensing",
  "Request a Demo",
  "Technical Support",
  "Onboarding & Implementation",
  "Partnership",
  "Other",
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ContactPage() {
  const heroRef    = useRef(null);
  const cardsRef   = useRef(null);
  const formRef    = useRef(null);

  const heroInView  = useInView(heroRef,  { once: true, amount: 0.3 });
  const cardsInView = useInView(cardsRef, { once: true, amount: 0.1 });
  const formInView  = useInView(formRef,  { once: true, amount: 0.1 });

  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", institution: "", topic: "", message: "" });

  const fadeUp: Variants = {
    hidden:  { opacity: 0, y: 28 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0, 0, 0.2, 1] } },
  };
  const stagger: Variants = {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // In production, wire this to your email / CRM API.
    setSent(true);
  }

  const inputCls = "w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400 transition";

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
      <section ref={heroRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-20 pb-12 text-center">
        <motion.div variants={stagger} initial="hidden" animate={heroInView ? "visible" : "hidden"} className="space-y-6 max-w-2xl mx-auto">
          <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30">
            <MessageSquare className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Get in Touch</span>
          </motion.div>
          <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-white">
            We&apos;d love to{" "}
            <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
              hear from you
            </span>
          </motion.h1>
          <motion.p variants={fadeUp} className="text-lg text-slate-600 dark:text-slate-300 leading-relaxed">
            Whether you&apos;re exploring a pilot, have a billing question, or simply want to see the platform — our team is ready to help.
          </motion.p>
        </motion.div>
      </section>

      {/* ── Contact cards ── */}
      <section ref={cardsRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        <motion.div variants={stagger} initial="hidden" animate={cardsInView ? "visible" : "hidden"}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {CONTACT_CARDS.map((c) => (
            <motion.a
              key={c.title}
              variants={fadeUp}
              href={c.href}
              className="group p-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-all duration-200 space-y-4"
            >
              <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${c.color} flex items-center justify-center shadow group-hover:scale-110 transition-transform duration-200`}>
                <c.icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="font-bold text-slate-900 dark:text-white">{c.title}</div>
                <div className="text-sm font-medium text-indigo-600 dark:text-indigo-400 mt-0.5">{c.detail}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{c.sub}</div>
              </div>
            </motion.a>
          ))}
        </motion.div>
      </section>

      {/* ── Form + sidebar ── */}
      <section ref={formRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={formInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-10"
        >
          {/* Sidebar */}
          <div className="space-y-8 lg:col-span-1">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <Building2 className="h-4 w-4 text-indigo-500" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">For Institutions</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Request a guided demo</h2>
              <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                Our implementation team will walk you through the platform end-to-end, configure a test environment for your institution, and answer every question your team has.
              </p>
            </div>
            <ul className="space-y-3">
              {[
                "No commitment required",
                "60-minute structured walkthrough",
                "Live Q&A with our product team",
                "Custom pilot scoping included",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                  <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Form */}
          <div className="lg:col-span-2">
            {sent ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center h-full py-16 gap-5 text-center"
              >
                <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Message sent!</h3>
                <p className="text-slate-600 dark:text-slate-300 max-w-sm">
                  Thanks for reaching out. Someone from our team will get back to you within one business day.
                </p>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Full Name *</label>
                    <input required className={inputCls} placeholder="Jane Wanjiku" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Work Email *</label>
                    <input required type="email" className={inputCls} placeholder="jane@university.ac.ke" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Institution</label>
                  <input className={inputCls} placeholder="University / College name" value={form.institution} onChange={e => setForm(f => ({ ...f, institution: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Topic *</label>
                  <select required className={inputCls} value={form.topic} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}>
                    <option value="">Select a topic…</option>
                    {TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Message *</label>
                  <textarea required rows={5} className={inputCls} placeholder="Tell us what you need…" value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
                </div>
                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 text-white font-semibold hover:from-indigo-500 hover:to-cyan-500 transition-all shadow-md hover:shadow-indigo-500/30"
                >
                  <Send className="h-4 w-4" /> Send Message
                </button>
              </form>
            )}
          </div>
        </motion.div>
      </section>

      <AppFooter />
    </div>
  );
}
