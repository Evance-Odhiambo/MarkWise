import { findCourseById, type CourseRecord } from "@/lib/courseStore";
import { findStudentByAdmissionIndexed, normalizeAdmission } from "@/lib/studentStore.server";
import { prisma } from "@/lib/prisma";
import type { GamificationStats } from "@/lib/gamificationEngine";

export type EnrolledUnitAttendance = {
  unitCode: string;
  unitTitle: string;
  attended: number;
  total: number;
  pct: number;
};

type VerificationPayload = {
  exists: boolean;
  admissionNumber: string;
  fullName: string | null;
  email: string | null;
  course: {
    id: string;
    code: string;
    name: string;
  } | null;
  department: { name: string } | null;
  hasAppAccount: boolean;
  hasAccount: boolean;
  enrolledUnitCount: number;
  enrolledUnits: EnrolledUnitAttendance[];
};

type VerificationCacheEntry = {
  expiresAtMs: number;
  payload: VerificationPayload;
};

export type VerificationLookupSource = "cache" | "db";

export type VerificationResult = {
  payload: VerificationPayload;
  lookupSource: VerificationLookupSource;
};

const VERIFICATION_CACHE_TTL_MS = 90_000;
const verificationCache = new Map<string, VerificationCacheEntry>();

const asCoursePayload = (course: CourseRecord | null) => {
  if (!course) return null;
  return {
    id: course.id,
    code: course.code,
    name: course.name,
  };
};

export async function verifyStudentByAdmission(admissionNumber: string, institutionId: string): Promise<VerificationResult> {
  const normalizedAdmission = normalizeAdmission(admissionNumber);
  const cacheKey = `${institutionId}:${normalizedAdmission}`;

  const cached = verificationCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAtMs > now) {
    return {
      payload: cached.payload,
      lookupSource: "cache",
    };
  }

  const lookup = await findStudentByAdmissionIndexed(normalizedAdmission, institutionId);
  if (!lookup.student) {
    const payload: VerificationPayload = {
      exists: false,
      admissionNumber: normalizedAdmission,
      fullName: null,
      email: null,
      course: null,
      department: null,
      hasAppAccount: false,
      hasAccount: false,
      enrolledUnitCount: 0,
      enrolledUnits: [],
    };

    verificationCache.set(cacheKey, {
      payload,
      expiresAtMs: now + VERIFICATION_CACHE_TTL_MS,
    });

    return {
      payload,
      lookupSource: "db",
    };
  }

  const studentId = lookup.student.id;

  const [course, enrollments, cachedPoints] = await Promise.all([
    findCourseById(lookup.student.courseId?.trim() ?? ""),
    prisma.enrollment.findMany({
      where: { studentId },
      select: { unit: { select: { code: true, title: true } } },
    }),
    prisma.studentPoints.findUnique({
      where: { studentId },
      select: { statsJson: true },
    }),
  ]);

  // Build unit title map from enrollments
  const unitTitleMap = new Map<string, string>();
  for (const e of enrollments) {
    unitTitleMap.set(e.unit.code.trim().toUpperCase(), e.unit.title);
  }

  // Extract per-unit attendance from cached statsJson
  let enrolledUnits: EnrolledUnitAttendance[] = [];
  if (cachedPoints?.statsJson) {
    const stats = cachedPoints.statsJson as unknown as GamificationStats;
    const unitAttendance = stats.unitAttendance ?? {};
    const enrolledSet = new Set(unitTitleMap.keys());
    enrolledUnits = Object.entries(unitAttendance)
      .filter(([uc]) => enrolledSet.size === 0 || enrolledSet.has(uc.trim().toUpperCase()))
      .map(([uc, { attended, total }]) => ({
        unitCode: uc,
        unitTitle: unitTitleMap.get(uc.trim().toUpperCase()) ?? "",
        attended,
        total,
        pct: total > 0 ? Math.round((attended / total) * 100) : 0,
      }))
      .sort((a, b) => a.unitCode.localeCompare(b.unitCode));
  } else {
    // No stats yet — list enrolled units with 0 attendance
    enrolledUnits = Array.from(unitTitleMap.entries()).map(([code, title]) => ({
      unitCode: code,
      unitTitle: title,
      attended: 0,
      total: 0,
      pct: 0,
    }));
  }

  const hasAccount = !!lookup.student.hasAuth;
  const payload: VerificationPayload = {
    exists: true,
    admissionNumber: normalizedAdmission,
    fullName: lookup.student.name,
    email: lookup.student.email ?? null,
    course: asCoursePayload(course),
    department: lookup.student.departmentName ? { name: lookup.student.departmentName } : null,
    hasAppAccount: hasAccount,
    hasAccount,
    enrolledUnitCount: enrollments.length,
    enrolledUnits,
  };

  // Do not cache found-student payloads — activeness data must always be live
  return {
    payload,
    lookupSource: "db",
  };
}

export function clearStudentVerificationCache() {
  verificationCache.clear();
}
