// app/terms/page.tsx
"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";
import { FileText, Mail } from "lucide-react";
import AppHeader from "@/app/components/AppHeader";
import AppFooter from "@/app/components/AppFooter";

const LAST_UPDATED = "15 April 2026";

const SECTIONS = [
  {
    title: "1. Agreement to Terms",
    body: [
      `By accessing or using the MarkWise platform — whether as an Institution Administrator, lecturer, or student — you agree to be bound by these Terms of Service ("Terms") and our Privacy Policy, which is incorporated herein by reference.`,
      `If you are using MarkWise on behalf of an institution, you represent that you have the authority to bind that institution to these Terms. If you do not agree, you must not use the platform.`,
    ],
  },
  {
    title: "2. Definitions",
    body: [
      `"Platform" means the MarkWise web application, APIs, and related services operated by MarkWise Technologies Ltd.`,
      `"Institution" means the higher-education organisation that has entered into a subscription agreement with MarkWise.`,
      `"Users" means all individuals who access the platform under an Institution's account, including administrators, lecturers, and students.`,
      `"Content" means any data, text, recordings, or materials uploaded or generated through the platform.`,
    ],
  },
  {
    title: "3. Eligibility & Account Registration",
    body: [
      `You must be at least 16 years old and have the legal capacity to enter into binding contracts to use the platform.`,
      `You are responsible for maintaining the confidentiality of your credentials and for all activity that occurs under your account. You must notify us immediately at hello@markwise.app of any unauthorised access or security breach.`,
      `You may not create accounts on behalf of others without their explicit consent, share access credentials, or use automated tools to create accounts.`,
    ],
  },
  {
    title: "4. Subscription & Payment",
    body: [
      `Access to MarkWise is licensed to institutions on a per-student, per-semester basis at the rates set out in the current pricing schedule. Pricing is subject to change with 60 days' written notice to Institution Administrators.`,
      `Invoices are payable within 30 days of issue. Unpaid balances beyond 60 days may result in suspension of the institution's account. MarkWise is not liable for any disruption to institutional operations arising from non-payment.`,
      `All fees are quoted exclusive of applicable taxes including VAT, which the institution is responsible for. Fees paid are non-refundable except where required by law or explicitly stated in a written agreement.`,
    ],
  },
  {
    title: "5. Acceptable Use",
    body: [
      `You agree not to:`,
      `(a) use the platform to distribute malware, conduct phishing, or engage in any unlawful activity;`,
      `(b) attempt to circumvent, reverse-engineer, or disable any security or anti-fraud feature, including BLE proximity verification;`,
      `(c) falsify attendance records, impersonate other users, or submit work that is not your own;`,
      `(d) scrape, mine, or otherwise extract data from the platform by automated means without prior written consent;`,
      `(e) use the platform in any way that could overload, damage, or impair its infrastructure.`,
      `Violations may result in immediate account suspension and, where appropriate, referral to law enforcement.`,
    ],
  },
  {
    title: "6. Intellectual Property",
    body: [
      `MarkWise owns all rights, title, and interest in the platform, including its source code, design, trademarks, and documentation. Nothing in these Terms transfers any IP rights to you.`,
      `Institutions retain ownership of all institutional data they upload (student records, timetables, course materials). You grant MarkWise a limited, non-exclusive licence to process that data solely to provide the service.`,
      `Feedback or suggestions you provide about the platform may be used by MarkWise without compensation or attribution.`,
    ],
  },
  {
    title: "7. Data & Privacy",
    body: [
      `Our collection and use of personal data is governed by our Privacy Policy. By using the platform, you consent to the practices described therein.`,
      `Institutions act as data controllers; MarkWise acts as a data processor. A Data Processing Agreement ("DPA") is available upon request and governs the processing of personal data subject to the Kenya Data Protection Act 2019 or other applicable law.`,
    ],
  },
  {
    title: "8. Service Availability & Maintenance",
    body: [
      `We target 99.5% uptime but do not guarantee uninterrupted access. Scheduled maintenance will be communicated at least 48 hours in advance. Emergency maintenance may occur without notice where security requires it.`,
      `MarkWise is not liable for any losses arising from planned or unplanned downtime, data delays, or service interruptions beyond our reasonable control.`,
    ],
  },
  {
    title: "9. Termination",
    body: [
      `Either party may terminate the agreement with 30 days' written notice. We may terminate or suspend access immediately if you breach these Terms, fail to pay, or if we determine continued access poses a security risk.`,
      `Upon termination, Institution Administrators may request a data export within 30 days. After that window, MarkWise will delete institutional data in accordance with our Privacy Policy.`,
    ],
  },
  {
    title: "10. Disclaimer of Warranties",
    body: [
      `The platform is provided "as is" and "as available." To the fullest extent permitted by law, MarkWise disclaims all warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.`,
      `We do not warrant that the platform is error-free or that defects will be corrected within any particular timeframe.`,
    ],
  },
  {
    title: "11. Limitation of Liability",
    body: [
      `To the maximum extent permitted by applicable law, MarkWise's total liability for any claim arising out of or relating to these Terms or the platform is limited to the fees paid by your institution in the three months preceding the claim.`,
      `In no event will MarkWise be liable for indirect, incidental, special, consequential, or punitive damages — including loss of revenue, data, or goodwill — even if advised of the possibility of such damages.`,
    ],
  },
  {
    title: "12. Governing Law & Disputes",
    body: [
      `These Terms are governed by the laws of the Republic of Kenya. Any dispute that cannot be resolved amicably within 30 days shall be referred to binding arbitration under the Nairobi Centre for International Arbitration Rules, with proceedings conducted in English in Nairobi.`,
      `Nothing in this clause prevents either party from seeking urgent injunctive relief from a court of competent jurisdiction.`,
    ],
  },
  {
    title: "13. Changes to These Terms",
    body: [
      `We may revise these Terms at any time. Material changes will be communicated to Institution Administrators by email at least 30 days in advance. Continued use of the platform after that period constitutes acceptance of the revised Terms.`,
    ],
  },
  {
    title: "14. Contact",
    body: [
      `For legal queries, please email legal@markwise.app or write to MarkWise Technologies Ltd., Westlands Business Park, 5th Floor, Nairobi, Kenya.`,
    ],
  },
];

export default function TermsPage() {
  const heroRef    = useRef(null);
  const heroInView = useInView(heroRef, { once: true, amount: 0.3 });

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 overflow-x-hidden">
      <AppHeader />

      {/* Hero */}
      <section ref={heroRef} className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 pt-20 pb-10 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={heroInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="space-y-5"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30">
            <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Terms of Service</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-white">
            Terms of Service
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Last updated: {LAST_UPDATED} · Effective immediately
          </p>
          <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Please read these terms carefully before using the MarkWise platform. They set out your rights and obligations as a user or institution.
          </p>
        </motion.div>
      </section>

      {/* Content */}
      <section className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-10">
          {/* Sticky table of contents */}
          <nav className="hidden lg:block lg:col-span-1">
            <div className="sticky top-24 space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Contents</p>
              {SECTIONS.map((s) => (
                <a
                  key={s.title}
                  href={`#${s.title.replace(/\s+/g, "-").toLowerCase()}`}
                  className="block text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors py-0.5"
                >
                  {s.title}
                </a>
              ))}
            </div>
          </nav>

          {/* Body */}
          <div className="lg:col-span-3 space-y-10">
            {SECTIONS.map((s, i) => (
              <motion.div
                key={s.title}
                id={s.title.replace(/\s+/g, "-").toLowerCase()}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.1 }}
                transition={{ duration: 0.5, delay: i * 0.04 }}
                className="space-y-3"
              >
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{s.title}</h2>
                {s.body.map((para, j) => (
                  <p key={j} className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{para}</p>
                ))}
              </motion.div>
            ))}

            {/* Contact box */}
            <div className="mt-10 p-6 rounded-2xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/5 flex items-start gap-4">
              <Mail className="h-5 w-5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold text-slate-900 dark:text-white text-sm">Legal queries?</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Email{" "}
                  <a href="mailto:legal@markwise.app" className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
                    legal@markwise.app
                  </a>{" "}
                  or visit our{" "}
                  <Link href="/contact" className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
                    contact page
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <AppFooter />
    </div>
  );
}
