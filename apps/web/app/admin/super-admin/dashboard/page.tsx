"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  Building2, ShieldCheck, Plus, RefreshCw, Users2,
  BarChart3, Crown,
} from "lucide-react";
import { useSuperAdmin } from "../context";

interface Stats {
  institutions: number;
  admins: number;
  lecturers: number;
  students: number;
}

interface Institution {
  id: string;
  name: string;
  _count: { admins: number; lecturers: number; students: number; departments: number };
}

const BASE = "/admin/super-admin";

export default function SuperAdminDashboard() {
  const admin = useSuperAdmin();
  const [stats, setStats] = useState<Stats | null>(null);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [sRes, iRes] = await Promise.all([
        fetch("/api/super/stats"),
        fetch("/api/super/institutions"),
      ]);
      if (sRes.ok) setStats(await sRes.json());
      if (iRes.ok) {
        const d = await iRes.json();
        setInstitutions((d.institutions ?? []).slice(0, 6));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Platform users = students + lecturers (billable units on the platform)
  const platformUsers = (stats?.students ?? 0) + (stats?.lecturers ?? 0);

  const kpis = [
    {
      label: "Institutions Onboarded",
      value: stats?.institutions ?? 0,
      icon: Building2,
      color: "text-sky-600",
      bg: "bg-sky-500/10",
      desc: "SaaS clients",
      href: `${BASE}/dashboard/institutions`,
    },
    {
      label: "Institution Admins",
      value: stats?.admins ?? 0,
      icon: ShieldCheck,
      color: "text-indigo-600",
      bg: "bg-indigo-500/10",
      desc: "Admin accounts created",
      href: `${BASE}/dashboard/admins`,
    },
    {
      label: "Platform Users",
      value: platformUsers,
      icon: Users2,
      color: "text-violet-600",
      bg: "bg-violet-500/10",
      desc: "Students + lecturers",
      href: `${BASE}/dashboard/analytics`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Crown className="h-4 w-4 text-violet-600" />
            <span className="text-xs font-medium text-violet-600 uppercase tracking-wider">MarkWise Platform</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome, {admin?.fullName?.split(" ")[0] ?? "Admin"}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Platform owner overview</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {kpis.map(({ label, value, icon: Icon, color, bg, desc, href }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
          >
            <Link href={href}>
              <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5 hover:border-gray-200 transition-colors cursor-pointer">
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${bg} mb-4`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <p className="text-3xl font-bold text-gray-900">
                  {loading ? "—" : value.toLocaleString()}
                </p>
                <p className="text-sm font-medium text-gray-900 mt-1">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Platform Actions</h2>
          <div className="space-y-2">
            {[
              { label: "Onboard New Institution",  href: `${BASE}/dashboard/institutions`, icon: Plus,       desc: "Register a new university or college on MarkWise" },
              { label: "Create Institution Admin",  href: `${BASE}/dashboard/admins`,       icon: ShieldCheck, desc: "Assign an admin to manage a newly onboarded institution" },
              { label: "View Platform Analytics",   href: `${BASE}/dashboard/analytics`,    icon: BarChart3,   desc: "Subscription usage and platform activity metrics" },
            ].map(({ label, href, icon: Icon, desc }) => (
              <Link key={href} href={href}>
                <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:bg-gray-100 hover:border-gray-200 transition-colors">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 mt-0.5">
                    <Icon className="h-3.5 w-3.5 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Onboarded Institutions */}
        <div className="rounded-2xl border border-gray-200 bg-white border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Onboarded Institutions</h2>
            <Link
              href={`${BASE}/dashboard/institutions`}
              className="text-xs text-violet-600 hover:text-violet-700 transition-colors"
            >
              View all
            </Link>
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 rounded-xl bg-gray-200 animate-pulse" />
              ))}
            </div>
          ) : institutions.length === 0 ? (
            <div className="py-8 text-center">
              <Building2 className="mx-auto h-8 w-8 text-gray-500 mb-2" />
              <p className="text-sm text-gray-400">No institutions onboarded yet.</p>
              <Link
                href={`${BASE}/dashboard/institutions`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-500/25 transition-colors"
              >
                <Plus className="h-3 w-3" /> Onboard First Institution
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {institutions.map((inst) => (
                <div
                  key={inst.id}
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/15">
                      <Building2 className="h-3.5 w-3.5 text-sky-600" />
                    </div>
                    <p className="text-sm font-medium text-gray-900">{inst.name}</p>
                  </div>
                  <p className="text-xs text-gray-400">
                    {(inst._count.students + inst._count.lecturers).toLocaleString()} users
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

