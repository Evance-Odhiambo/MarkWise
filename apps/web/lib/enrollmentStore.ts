
import { prisma } from "@/lib/prisma";
import { normalizeUnitCode as _normalizeUnitCode } from "@/lib/unitCode";
export type EnrollmentMap = Record<string, string[]>;

// Re-export canonical normaliser so callers don't need two imports.
export const normalizeUnitCode = (value: string) => _normalizeUnitCode(value);

const isEnrollmentMap = (value: unknown): value is EnrollmentMap => {
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(
    (entry) => Array.isArray(entry) && entry.every((item) => typeof item === "string"),
  );
};

// Returns a map of studentId to array of unitIds for all enrollments
export async function getEnrollmentMap(): Promise<EnrollmentMap> {
  const enrollments = await prisma.enrollment.findMany();
  const map: EnrollmentMap = {};
  for (const e of enrollments) {
    if (!map[e.studentId]) map[e.studentId] = [];
    map[e.studentId].push(e.unitId);
  }
  return map;
}
// ...existing code...

// Deprecated: Use Prisma create/update/delete methods directly for persistence
export async function writeEnrollments(enrollments: EnrollmentMap): Promise<void> {
  throw new Error("writeEnrollments is deprecated. Use Prisma directly.");
}

export async function isStudentEnrolledForUnit(studentId: string, unitCodeOrId: string): Promise<boolean> {
  let unitId: string;

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(unitCodeOrId)) {
    unitId = unitCodeOrId;
  } else {
    const normalized = normalizeUnitCode(unitCodeOrId);
    // Case-insensitive exact match
    let unit = await prisma.unit.findFirst({
      where: { code: { equals: normalized, mode: 'insensitive' } },
    });
    // Raw SQL fallback: strip spaces from both sides so "SCH2170" ↔ "SCH 2170" always match.
    if (!unit) {
      const normalizedStripped = normalized.replace(/ /g, "");
      const rows = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Unit" WHERE REPLACE(UPPER(code), ' ', '') = ${normalizedStripped} LIMIT 1
      `;
      if (rows.length > 0) {
        unit = await prisma.unit.findUnique({ where: { id: rows[0].id } });
      }
    }
    if (!unit) return false;
    unitId = unit.id;
  }

  // Check direct enrollment and course-based enrollment in parallel
  const [directEnrollment, student] = await Promise.all([
    prisma.enrollment.findFirst({ where: { studentId, unitId } }),
    prisma.student.findFirst({
      where: { id: studentId, course: { units: { some: { id: unitId } } } },
    }),
  ]);
  return !!(directEnrollment || student);
}
