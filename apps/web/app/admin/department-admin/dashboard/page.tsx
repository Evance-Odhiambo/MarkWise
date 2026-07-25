"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Users, BookOpen, Calendar, ClipboardCheck, ArrowRight, GraduationCap } from "lucide-react";
import { useDepartmentAdmin } from "../context";

function getGreeting(): { text: string; icon: string } {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return { text: "Good morning",   icon: "☀️"  };
  if (h >= 12 && h < 17) return { text: "Good afternoon", icon: "🌤️" };
  if (h >= 17 && h < 21) return { text: "Good evening",   icon: "🌆"  };
  return                         { text: "Good night",     icon: "🌙"  };
}

export default function DepartmentDashboard() {
  const admin = useDepartmentAdmin();
  const [stats, setStats] = useState({ students: 0, courses: 0, lecturers: 0, timetableEntries: 0 });
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!admin?.departmentId) return;
    setLoading(true);
    const [s, c, l, t] = await Promise.all([
      fetch(`/api/students?departmentId=${admin.departmentId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/courses?departmentId=${admin.departmentId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/lecturers?departmentId=${admin.departmentId}`, { credentials: "include" }).then(r => r.ok ? r.json() : {}) as any,
      fetch(`/api/timetable?departmentId=${admin.departmentId}`, { credentials: "include" }).then(r => r.ok ? r.json() : []) as any,
    ]);
    setStats({
      students: (s.students ?? s.data ?? s ?? []).length,
      courses: (c.courses ?? c.data ?? c ?? []).length,
      lecturers: (l.lecturers ?? l.data ?? l ?? []).length,
      timetableEntries: Array.isArray(t) ? t.length : (t.entries ?? t.data ?? []).length,
    });
    setLoading(false);
  }, [admin?.departmentId]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const statCards = [
    { label: "Students",         value: stats.students,         icon: Users,          color: "text-emerald-600", bg: "bg-emerald-500/10",  href: "/admin/department-admin/dashboard/students"  },
    { label: "Courses",          value: stats.courses,          icon: BookOpen,       color: "text-amber-600",   bg: "bg-amber-500/10",    href: "/admin/department-admin/dashboard/courses"   },
    { label: "Lecturers",        value: stats.lecturers,        icon: GraduationCap,  color: "text-sky-600",     bg: "bg-sky-500/10",      href: "/admin/department-admin/dashboard/lecturers" },
    { label: "Timetable Entries",value: stats.timetableEntries, icon: Calendar,       color: "text-violet-600",  bg: "bg-violet-500/10",   href: "/admin/department-admin/dashboard/timetable" },
  ];

  const quickActions = [
    { label: "View Timetable",  href: "/admin/department-admin/dashboard/timetable",  icon: Calendar,        color: "bg-orange-500/10 text-orange-600 hover:bg-orange-500/20"  },
    { label: "Manage Curriculum",href: "/admin/department-admin/dashboard/curriculum", icon: ClipboardCheck,  color: "bg-violet-500/10 text-violet-600 hover:bg-violet-500/20"  },
    { label: "View Students",   href: "/admin/department-admin/dashboard/students",   icon: Users,           color: "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"},
    { label: "View Lecturers",  href: "/admin/department-admin/dashboard/lecturers",  icon: GraduationCap,   color: "bg-sky-500/10 text-sky-600 hover:bg-sky-500/20"           },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 p-5">
        <p className="text-sm text-indigo-200 font-medium">Welcome back,</p>
        <h1 className="text-2xl font-bold text-white mt-0.5">{admin?.fullName?.split(" ")[0] ?? "Admin"} 👋</h1>
        <p className="text-sm text-indigo-200 mt-1">Department Admin · {admin?.departmentName} · {admin?.institutionName}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg, href }) => (
          <Link key={label} href={href}>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-gray-200 bg-white p-4 hover:shadow-md transition-shadow cursor-pointer">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${bg} mb-3`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <p className="text-2xl font-bold text-gray-900">{loading ? "—" : value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </motion.div>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickActions.map(({ label, href, icon: Icon, color }) => (
            <Link key={label} href={href}>
              <div className={`flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium transition-colors hover:shadow-sm cursor-pointer ${color}`}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
                <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
