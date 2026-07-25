// app/page.tsx
"use client";

import { Suspense, useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { motion, useInView, AnimatePresence } from "framer-motion";
import type { Variants } from "framer-motion";
import { 
  ArrowRight, 
  CheckCircle, 
  TrendingUp, 
  Shield, 
  Layers,
  Calendar,
  BarChart3,
  Users,
  Users2,
  Sparkles,
  Building2,
  GraduationCap,
  DoorOpen,
  Bell,
} from "lucide-react";
import AppHeader from "./components/AppHeader";
import AppFooter from "./components/AppFooter";

// ──────────────────────────────────────────────
// ADMIN ROLES CONFIGURATION
// ──────────────────────────────────────────────
// ✅ MOVED OUTSIDE COMPONENT - Consistent on server & client
const ADMIN_ROLES_CONFIG = [
  {
    icon: <Building2 className="h-6 w-6" />,
    title: "System Administrator",
    description: "Onboards and manages an entire institution — departments, staff, and settings.",
    href: "/admin/system-admin/register",
    color: "from-indigo-500 to-blue-500",
    badge: "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30",
  },
  {
    icon: <GraduationCap className="h-6 w-6" />,
    title: "Academic Registrar",
    description: "Manages students, lecturers, curriculum, timetable, enrolments, and academic analytics.",
    href: "/admin/academic-registrar/register",
    color: "from-purple-500 to-violet-500",
    badge: "bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30",
  },
  {
    icon: <DoorOpen className="h-6 w-6" />,
    title: "Facilities Manager",
    description: "Controls room bookings, reservations, space availability, and physical resource allocation.",
    href: "/admin/facilities-manager/register",
    color: "from-orange-500 to-red-400",
    badge: "bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-500/30",
  },
  {
    icon: <Users2 className="h-6 w-6" />,
    title: "Department Admin",
    description: "Manages timetable, curriculum, students, lecturers, and courses within a specific department.",
    href: "/admin/department-admin/register",
    color: "from-teal-500 to-emerald-400",
    badge: "bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-500/30",
  },
];

// ──────────────────────────────────────────────
// STATIC DATA - Moved outside for consistency
// ──────────────────────────────────────────────
const FEATURES_DATA = [
  {
    icon: <CheckCircle className="h-6 w-6" />,
    title: "Verified Attendance Sessions",
    description: "Session-based attendance that confirms who was present, when, and in which class context.",
    color: "from-blue-500 to-cyan-500",
  },
  {
    icon: <BarChart3 className="h-6 w-6" />,
    title: "Hybrid Presence and Engagement",
    description: "Supports physical, online, and hybrid lessons with engagement check-ins and session activity visibility.",
    color: "from-purple-500 to-pink-500",
  },
  {
    icon: <Calendar className="h-6 w-6" />,
    title: "Real-Time Room Coordination",
    description: "See room availability, reserve spaces, and align attendance sessions with assigned venues.",
    color: "from-green-500 to-emerald-500",
  },
  {
    icon: <Layers className="h-6 w-6" />,
    title: "Assignment Submission Integrity",
    description: "Centralized assignment creation, timestamped submissions, and version-aware resubmission tracking.",
    color: "from-orange-500 to-red-500",
  },
  {
    icon: <Users className="h-6 w-6" />,
    title: "Structured Group Management",
    description: "Balanced group setup, controlled enrollment, and clear accountability for group submissions.",
    color: "from-indigo-500 to-purple-500",
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: "Centralized Updates and Inclusive Access",
    description: "Lesson updates and materials stay in one trusted channel, with low-data, smartphone-friendly access.",
    color: "from-pink-500 to-rose-500",
  },
];

const STATS_DATA = [
  { value: "3 Modes", label: "Physical, online, and hybrid", icon: <Users className="h-5 w-5" /> },
  { value: "3 Layers", label: "Device, proximity, and activity checks", icon: <Shield className="h-5 w-5" /> },
  { value: "1 Platform", label: "Attendance, rooms, and updates", icon: <Calendar className="h-5 w-5" /> },
  { value: "End-to-End", label: "Assignments and group workflows", icon: <CheckCircle className="h-5 w-5" /> },
];

const TESTIMONIALS_DATA = [
  {
    quote: "Paper attendance captures names, but it does not prove that the student was truly present.",
    name: "University Administrator",
    role: "Interview Insight",
    image: "UA",
    rating: 5,
  },
  {
    quote: "Students miss classes because updates are spread across chats and informal channels.",
    name: "Department Lecturer",
    role: "Interview Insight",
    image: "DL",
    rating: 5,
  },
  {
    quote: "Room conflicts and unclear availability create delays even when teaching plans are ready.",
    name: "Campus Operations Lead",
    role: "Interview Insight",
    image: "CO",
    rating: 5,
  },
];

const HOW_IT_WORKS_DATA = [
  {
    step: "01",
    title: "Launch a Verified Session",
    description: "Start a class session with timing controls and the right room or online context.",
    icon: <Layers className="h-8 w-8" />,
  },
  {
    step: "02",
    title: "Confirm Presence and Engagement",
    description: "Students check in within active windows while lecturers monitor real-time attendance signals.",
    icon: <Calendar className="h-8 w-8" />,
  },
  {
    step: "03",
    title: "Coordinate Work Beyond Attendance",
    description: "Manage assignments, groups, updates, and reports from one consistent academic record.",
    icon: <BarChart3 className="h-8 w-8" />,
  },
];

// ──────────────────────────────────────────────
// ANIMATION VARIANTS - Moved outside
// ──────────────────────────────────────────────
const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0, 0, 0.2, 1] } }
};

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    }
  }
};

// ──────────────────────────────────────────────
// COMPONENT
// ──────────────────────────────────────────────
function LandingPageContent() {
  const router = useRouter();
  const pathname = usePathname(); // ✅ Added for consistent routing

  // ──── Refs for Intersection Observer ────
  const heroRef = useRef(null);
  const featuresRef = useRef(null);
  const statsRef = useRef(null);
  const howItWorksRef = useRef(null);
  const testimonialsRef = useRef(null);
  const rolesRef = useRef(null);
  const ctaRef = useRef(null);

  // ──── UseInView hooks ────
  const heroInView = useInView(heroRef, { once: true, amount: 0.3 });
  const featuresInView = useInView(featuresRef, { once: true, amount: 0.2 });
  const statsInView = useInView(statsRef, { once: true, amount: 0.3 });
  const howItWorksInView = useInView(howItWorksRef, { once: true, amount: 0.3 });
  const testimonialsInView = useInView(testimonialsRef, { once: true, amount: 0.2 });
  const rolesInView = useInView(rolesRef, { once: true, amount: 0.2 });
  const ctaInView = useInView(ctaRef, { once: true, amount: 0.5 });

  // ──── UseMemo for static data to ensure consistency ────
  const features = useMemo(() => FEATURES_DATA, []);
  const stats = useMemo(() => STATS_DATA, []);
  const adminRoles = useMemo(() => ADMIN_ROLES_CONFIG, []);
  const testimonials = useMemo(() => TESTIMONIALS_DATA, []);
  const howItWorks = useMemo(() => HOW_IT_WORKS_DATA, []);

  // ──── UseState for client-side only hydration ────
  const [isMounted, setIsMounted] = useState(false);

  // ──── useEffect for client-side only rendering ────
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // ──────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 overflow-x-hidden">
      {/* Animated Background */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 -left-4 w-48 h-48 sm:w-72 sm:h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob"></div>
        <div className="absolute top-0 -right-4 w-48 h-48 sm:w-72 sm:h-72 bg-yellow-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-20 w-48 h-48 sm:w-72 sm:h-72 bg-pink-300 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-4000"></div>
      </div>

      <AppHeader />

      {/* Hero Section */}
      <section ref={heroRef} className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 min-h-[calc(100vh-5rem)] flex items-center py-8 sm:py-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate={heroInView ? "visible" : "hidden"}
            className="space-y-8"
          >
            <motion.div variants={fadeInUp} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30">
              <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                Verified Attendance and Learning Coordination
              </span>
            </motion.div>

            <motion.h1 variants={fadeInUp} className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold tracking-tight">
              Replace Fragmented
              <span className="block mt-2 bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 bg-clip-text text-transparent">
                Campus Operations
              </span>
            </motion.h1>

            <motion.p variants={fadeInUp} className="text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-xl">
              MarkWise unifies attendance verification, room coordination, assignment workflows, routine updates,student group management, data insights,
              and learning analytics for institutions running physical, online, and hybrid learning.
            </motion.p>          

            <motion.div variants={fadeInUp} className="flex items-center gap-6 pt-4">
              <div className="flex -space-x-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-8 w-8 rounded-full bg-gradient-to-r from-indigo-600 to-cyan-600 border-2 border-white dark:border-slate-950" />
                ))}
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                <span className="font-bold text-indigo-600 dark:text-indigo-400">Built from 150+ interviews</span> across 20+ institutions
              </p>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.8, rotateY: -10 }}
            animate={heroInView ? { opacity: 1, scale: 1, rotateY: 0 } : { opacity: 0, scale: 0.8, rotateY: -10 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            <div className="relative w-full max-w-lg mx-auto">
              {/* Global Features Card */}
              <div className="relative rounded-3xl border-2 border-green-200 dark:border-cyan-500/30 bg-gradient-to-br from-white via-green-50 to-cyan-50 dark:from-slate-900 dark:via-green-950 dark:to-cyan-950 backdrop-blur-sm p-8 shadow-2xl overflow-hidden">
                <div className="flex items-center gap-4 mb-6">
                  <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-green-500 to-cyan-400 flex items-center justify-center shadow-lg">
                    <Sparkles className="h-8 w-8 text-white" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-2xl text-green-700 dark:text-cyan-300 tracking-tight">All-in-One Campus Platform</h3>
                    <p className="text-sm text-zinc-700 dark:text-zinc-200">Modern, secure, and ready for your institution</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-green-50 dark:bg-green-900/30">
                    <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-300" />
                    <div>
                      <div className="font-bold text-green-700 dark:text-green-200">Verified Attendance</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-300">Fast, real-time, fraud-proof, and session-based</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-cyan-50 dark:bg-cyan-900/30">
                    <Calendar className="h-6 w-6 text-cyan-600 dark:text-cyan-300" />
                    <div>
                      <div className="font-bold text-cyan-700 dark:text-cyan-200">Room Availability</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-300">Book, view, and manage campus spaces</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-purple-50 dark:bg-purple-900/30">
                    <Users className="h-6 w-6 text-purple-600 dark:text-purple-300" />
                    <div>
                      <div className="font-bold text-purple-700 dark:text-purple-200">Study Groups</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-300">Create, join, and manage collaborative teams</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-50 dark:bg-orange-900/30">
                    <Layers className="h-6 w-6 text-orange-600 dark:text-orange-300" />
                    <div>
                      <div className="font-bold text-orange-700 dark:text-orange-200">Assignments</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-300">Centralized creation, submission, and feedback</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/30">
                    <BarChart3 className="h-6 w-6 text-blue-600 dark:text-blue-300" />
                    <div>
                      <div className="font-bold text-blue-700 dark:text-blue-200">Analytics & Reports</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-300">Insights for students, staff, and leadership</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-pink-50 dark:bg-pink-900/30">
                    <Shield className="h-6 w-6 text-pink-600 dark:text-pink-300" />
                    <div>
                      <div className="font-bold text-pink-700 dark:text-pink-200">Secure & Inclusive</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-300">Privacy-first, offline-capable, accessible, and mobile-friendly</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/30">
                    <Bell className="h-6 w-6 text-indigo-600 dark:text-indigo-300" />
                    <div>
                      <div className="font-bold text-indigo-700 dark:text-indigo-200">Notifications</div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-300">Instant alerts for classes, bookings, and updates</div>
                    </div>
                  </div>
                </div>
                <div className="mt-8 flex flex-col items-center">
                  <span className="text-lg font-bold text-green-700 dark:text-cyan-200">Ready to pilot MarkWise?</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-300">Join the next generation of campus management</span>
                </div>
              </div>
              {/* Floating elements — hidden on small mobile to prevent overflow */}
              <div className="absolute -top-4 -right-4 h-16 w-16 rounded-2xl bg-gradient-to-r from-green-400 to-cyan-400 items-center justify-center shadow-xl animate-float hidden sm:flex">
                <TrendingUp className="h-8 w-8 text-white" />
              </div>
              <div className="absolute -bottom-4 -left-4 h-20 w-20 rounded-2xl bg-gradient-to-r from-purple-500 to-pink-500 items-center justify-center shadow-xl animate-float animation-delay-2000 hidden sm:flex">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats Section */}
      <section ref={statsRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={statsInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.6 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8"
        >
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={statsInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="relative group"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-cyan-600 rounded-2xl opacity-0 group-hover:opacity-10 transition-opacity" />
              <div className="relative p-6 text-center">
                <div className="flex justify-center mb-2 text-indigo-600 dark:text-indigo-400">
                  {stat.icon}
                </div>
                <div className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-indigo-600 to-cyan-600 bg-clip-text text-transparent">
                  {stat.value}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-300">{stat.label}</div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Features Section */}
      <section id="features" ref={featuresRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={featuresInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-4 mb-16"
        >
          <span className="inline-block px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 text-sm font-medium">
            Features
          </span>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
            Everything Needed to Run
            <span className="block mt-2 bg-gradient-to-r from-indigo-600 to-cyan-600 bg-clip-text text-transparent">
              Trusted Academic Operations
            </span>
          </h2>
          <p className="max-w-2xl mx-auto text-lg text-slate-600 dark:text-slate-300">
            Move from disconnected paper sheets, chat updates, and ad hoc workflows
            to one coordinated system for attendance and learning continuity.
          </p>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate={featuresInView ? "visible" : "hidden"}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8"
        >
          {features.map((feature) => (
            <motion.article
              key={feature.title}
              variants={fadeInUp}
              whileHover={{ y: -8, transition: { duration: 0.3 } }}
              className="group relative"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-cyan-600 rounded-2xl opacity-0 group-hover:opacity-5 transition-opacity" />
              <div className="relative p-8 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-all duration-300">
                <div className={`h-14 w-14 rounded-xl bg-gradient-to-r ${feature.color} flex items-center justify-center mb-6 text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                  {feature.icon}
                </div>
                <h3 className="text-lg font-bold mb-3 text-slate-900 dark:text-white">{feature.title}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{feature.description}</p>
                
                <div className="mt-6 flex items-center text-indigo-600 dark:text-indigo-400 font-medium text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                  Learn more
                  <ArrowRight className="ml-2 h-4 w-4" />
                </div>
              </div>
            </motion.article>
          ))}
        </motion.div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" ref={howItWorksRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={howItWorksInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.6 }}
          className="relative rounded-3xl bg-gradient-to-br from-slate-100 to-indigo-50 dark:from-slate-900 dark:to-indigo-950/50 p-8 lg:p-16 overflow-hidden"
        >
          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-indigo-200 to-cyan-200 rounded-full blur-3xl opacity-30 dark:opacity-20" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-gradient-to-tr from-purple-200 to-pink-200 rounded-full blur-3xl opacity-30 dark:opacity-20" />

          <div className="relative z-10">
            <div className="text-center space-y-4 mb-16">
              <span className="inline-block px-4 py-2 rounded-full bg-white/80 dark:bg-slate-800/80 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 text-sm font-medium backdrop-blur-sm">
                How It Works
              </span>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
                Simple Steps to
                <span className="block mt-2 bg-gradient-to-r from-indigo-600 to-cyan-600 bg-clip-text text-transparent">
                  Coordinated Learning
                </span>
              </h2>
            </div>

            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate={howItWorksInView ? "visible" : "hidden"}
              className="grid md:grid-cols-3 gap-8 lg:gap-12"
            >
              {howItWorks.map((item, index) => (
                <motion.div
                  key={item.step}
                  variants={fadeInUp}
                  className="relative text-center group"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-cyan-600 rounded-3xl opacity-0 group-hover:opacity-5 transition-opacity" />
                  
                  <div className="relative p-8">
                    <div className="flex justify-center mb-6">
                      <div className="h-20 w-20 rounded-2xl bg-white dark:bg-slate-800 shadow-xl flex items-center justify-center text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform duration-300">
                        {item.icon}
                      </div>
                    </div>
                    
                    <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mb-2">
                      {item.step}
                    </div>
                    
                    <h3 className="text-lg font-bold mb-3 text-slate-900 dark:text-white">
                      {item.title}
                    </h3>
                    
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                      {item.description}
                    </p>

                    {index < 2 && (
                      <div className="hidden md:block absolute top-1/2 -right-6 text-indigo-300 dark:text-indigo-600">
                        <ArrowRight className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" ref={testimonialsRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={testimonialsInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-4 mb-16"
        >
          <span className="inline-block px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 text-sm font-medium">
            Testimonials
          </span>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
            Grounded in Real Institutional
            <span className="block mt-2 bg-gradient-to-r from-indigo-600 to-cyan-600 bg-clip-text text-transparent">
              Pain Points
            </span>
          </h2>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate={testimonialsInView ? "visible" : "hidden"}
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
        >
          {testimonials.map((item) => (
            <motion.article
              key={item.name}
              variants={fadeInUp}
              whileHover={{ y: -8, transition: { duration: 0.3 } }}
              className="group relative"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-cyan-600 rounded-2xl opacity-0 group-hover:opacity-5 transition-opacity" />
              
              <div className="relative p-8 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-all duration-300">
                {/* Quote mark */}
                <div className="text-6xl font-serif text-indigo-200 dark:text-indigo-800/50 leading-none mb-4">&quot;</div>
                
                <p className="text-base italic mb-6 text-slate-700 dark:text-slate-200">
                  {item.quote}
                </p>
                
                {/* Rating */}
                <div className="flex gap-1 mb-4">
                  {[...Array(item.rating)].map((_, i) => (
                    <span key={i} className="text-yellow-400">★</span>
                  ))}
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-r from-indigo-600 to-cyan-600 flex items-center justify-center text-white font-bold text-lg">
                    {item.image}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">{item.name}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{item.role}</p>
                  </div>
                </div>
              </div>
            </motion.article>
          ))}
        </motion.div>
      </section>

      {/* Admin Roles Section - FIXED HYDRATION ISSUE */}
      <section ref={rolesRef} id="admin-roles" className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={rolesInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-4 mb-16"
        >
          <span className="inline-block px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 text-sm font-medium">
            Admin Roles
          </span>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
            Four Roles,
            <span className="block mt-2 bg-gradient-to-r from-indigo-600 to-cyan-600 bg-clip-text text-transparent">
              One Coordinated Institution
            </span>
          </h2>
          <p className="max-w-2xl mx-auto text-lg text-slate-600 dark:text-slate-300">
            Each role has a focused scope — from institution-wide oversight down to department-level operations — so authority is clear and nothing falls through the gaps.
          </p>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate={rolesInView ? "visible" : "hidden"}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
        >
          {adminRoles.map((role) => (
            <motion.div
              key={role.title}
              variants={fadeInUp}
              whileHover={{ y: -6, transition: { duration: 0.3 } }}
              className="group relative"
            >
              <div className="relative p-7 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-all duration-300 h-full flex flex-col">
                <div className={`h-12 w-12 rounded-xl bg-gradient-to-r ${role.color} flex items-center justify-center mb-5 text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
                  {role.icon}
                </div>
                <span className={`self-start mb-3 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${role.badge}`}>
                  {role.title}
                </span>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed flex-1">{role.description}</p>
                {/* ✅ FIXED: Using key to force re-render on pathname change */}
                <Link
                  key={pathname} // ← This ensures consistent href between server and client
                  href={role.href}
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:gap-2.5 transition-all"
                >
                  Register
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* CTA Section */}
      <section id="for-institutions" ref={ctaRef} className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={ctaInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.6 }}
          className="relative rounded-3xl overflow-hidden"
        >
          {/* Background gradient */}
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600">
            <div className="absolute inset-0 bg-grid-white/10" />
          </div>
          
          {/* Animated circles */}
          <div className="absolute top-0 -left-4 w-24 h-24 bg-white rounded-full opacity-10 animate-pulse" />
          <div className="absolute bottom-0 -right-4 w-32 h-32 bg-white rounded-full opacity-10 animate-pulse animation-delay-2000" />
          
          <div className="relative z-10 px-8 py-16 lg:py-24 text-center text-white">
            <motion.h2 
              initial={{ opacity: 0, y: 20 }}
              animate={ctaInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-6"
            >
              Ready to Pilot MarkWise in Your Institution?
            </motion.h2>
            
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={ctaInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="text-base sm:text-lg mb-10 max-w-2xl mx-auto opacity-90"
            >
              Register as System Administrator to onboard your institution, then add your Academic Registrar,
              Facilities Manager, and Department Administrators to activate the full platform.
            </motion.p>
            
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={ctaInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex justify-center"
            >
              <Link
                key={pathname} // ← Added key for consistency
                href="/admin/system-admin/register"
                className="group px-10 py-4 bg-indigo-600 text-white rounded-2xl font-semibold text-lg hover:shadow-2xl transition-all duration-300 hover:scale-105 flex items-center justify-center gap-2"
              >
                Get Started — Register Your Institution
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

// ──────────────────────────────────────────────
// EXPORT
// ──────────────────────────────────────────────
export default function LandingPageWithSuspense() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-16 w-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LandingPageContent />
    </Suspense>
  );
}