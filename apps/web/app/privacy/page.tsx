// app/privacy/page.tsx
"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "framer-motion";
import { ShieldCheck, Mail } from "lucide-react";
import AppHeader from "@/app/components/AppHeader";
import AppFooter from "@/app/components/AppFooter";

const LAST_UPDATED = "15 April 2026";

const SECTIONS = [
  {
    title: "1. Who We Are",
    body: [
      `MarkWise ("we", "us", or "our") is a campus management platform operated by MarkWise Technologies Ltd., incorporated in Kenya. Our registered address is Westlands Business Park, 5th Floor, Nairobi, Kenya.`,
      `We act as a data processor on behalf of the institutions that subscribe to our platform ("Institution Administrators"), who remain the data controllers for the personal information of their students, lecturers, and staff.`,
    ],
  },
  {
    title: "2. Information We Collect",
    body: [
      `Account & profile data: full name, email address, institutional role (student, lecturer, administrator), department, and profile photo where provided.`,
      `Attendance data: device identifiers used for BLE-based proximity verification, session check-in timestamps, and location context scoped to the classroom or venue.`,
      `Academic data: unit enrolments, timetable entries, assignment submissions, grades visible to the student's enrolled courses, and study group membership.`,
      `Room & booking data: room reservation requests, booking timestamps, and occupancy signals.`,
      `Usage data: log files, IP addresses, browser type, and interaction events collected automatically when you use the platform.`,
    ],
  },
  {
    title: "3. How We Use Your Information",
    body: [
      `To provide and operate the platform, including attendance verification, timetable coordination, and assignment management.`,
      `To maintain accurate, tamper-evident audit records that institutions can use for governance and compliance purposes.`,
      `To send system notifications — such as attendance alerts, booking confirmations, and assignment deadlines — that are necessary for the service.`,
      `To improve the platform through aggregated, anonymised analytics. We never sell individual user data to third parties.`,
      `To comply with applicable laws, enforce our Terms of Service, and respond to legal process.`,
    ],
  },
  {
    title: "4. Legal Bases for Processing",
    body: [
      `Contract: Processing is necessary to perform our agreement with your institution or with you directly.`,
      `Legitimate interests: We process usage data to ensure security, detect fraud, and improve performance.`,
      `Legal obligation: We retain certain records to comply with accounting, tax, and education-sector regulations in Kenya.`,
    ],
  },
  {
    title: "5. Data Sharing",
    body: [
      `We do not sell, rent, or trade your personal data. We share data only with:`,
      `Your Institution: Administrators at your institution can access data relevant to their role (e.g., attendance records for lecturers, enrolment data for registrars).`,
      `Authorised sub-processors: Cloud infrastructure providers, email delivery services, and analytics tools bound by data processing agreements with equivalent safeguards.`,
      `Legal authorities: Where required by law, court order, or to protect the safety of our users.`,
    ],
  },
  {
    title: "6. Data Retention",
    body: [
      `We retain personal data for as long as your institution's subscription is active, plus a maximum of 36 months after termination to allow for dispute resolution and regulatory compliance.`,
      `Attendance logs and academic records may be retained longer where required by Kenyan education-sector regulations or at the explicit written request of the institution.`,
      `You may request deletion of your own account data by contacting your institution administrator, who can submit a deletion request to us.`,
    ],
  },
  {
    title: "7. Security",
    body: [
      `We implement industry-standard security measures including TLS encryption in transit, AES-256 encryption at rest, role-based access controls, and regular third-party penetration testing.`,
      `Access to production systems is limited to authorised personnel. All access events are logged and audited.`,
      `In the event of a data breach that is likely to result in a risk to your rights and freedoms, we will notify the relevant institution administrators and, where required, the Office of the Data Protection Commissioner of Kenya within 72 hours.`,
    ],
  },
  {
    title: "8. Your Rights",
    body: [
      `Under Kenya's Data Protection Act (2019) and, where applicable, the EU GDPR, you have the right to: access the personal data we hold about you; request correction of inaccurate data; request erasure ("right to be forgotten") subject to our legal retention obligations; object to or restrict processing in certain circumstances; and data portability.`,
      `To exercise these rights, contact your institution's data protection contact or reach us directly at privacy@markwise.app.`,
    ],
  },
  {
    title: "9. Cookies",
    body: [
      `We use strictly necessary cookies to maintain your authenticated session and ensure the security of the platform. We do not use cross-site tracking cookies or serve advertising.`,
      `Browser storage (localStorage / sessionStorage) is used to maintain UI state such as your currently selected tab or filter preferences.`,
    ],
  },
  {
    title: "10. Changes to This Policy",
    body: [
      `We may update this Privacy Policy from time to time. Material changes will be notified to Institution Administrators by email and highlighted in the platform. Continued use of the platform after the effective date of any change constitutes acceptance of the revised policy.`,
    ],
  },
  {
    title: "11. Contact",
    body: [
      `For privacy-related queries, please email privacy@markwise.app or write to us at MarkWise Technologies Ltd., Westlands Business Park, 5th Floor, Nairobi, Kenya.`,
    ],
  },
];

export default function PrivacyPage() {
  const heroRef = useRef(null);
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
            <ShieldCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Privacy Policy</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-white">
            Your privacy matters to us
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Last updated: {LAST_UPDATED} · Effective immediately
          </p>
          <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto leading-relaxed">
            This policy explains what personal information MarkWise collects, how we use it, and what rights you have. We have written it in plain language — no legal degree required.
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
                <p className="font-semibold text-slate-900 dark:text-white text-sm">Privacy questions?</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Email us at{" "}
                  <a href="mailto:privacy@markwise.app" className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">
                    privacy@markwise.app
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
