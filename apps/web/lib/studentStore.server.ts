export async function findStudentByAdmissionIndexed(
  normalizedAdmission: string,
  institutionId?: string
): Promise<{ student: StudentRecord | null }> {
  const item = institutionId
    ? await prisma.student.findUnique({
        where: { institutionId_admissionNumber: { institutionId, admissionNumber: normalizedAdmission } },
        include: { auth: true, department: { select: { name: true } } },
      })
    : await prisma.student.findFirst({
        where: { admissionNumber: normalizedAdmission },
        include: { auth: true, department: { select: { name: true } } },
      });
  if (!item) return { student: null };
  return {
    student: {
      id: item.id,
      name: item.name,
      admissionNumber: item.admissionNumber,
      courseId: item.courseId,
      institutionId: item.institutionId,
      email: item.auth?.email ?? undefined,
      hasAuth: !!item.auth,
      departmentId: item.departmentId,
      departmentName: item.department?.name ?? undefined,
    },
  };
}
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
import { prisma } from "@/lib/prisma";
import path from "node:path";

export type StudentRecord = {
  id: string;
  name: string;
  admissionNumber: string;
  courseId?: string;
  institutionId: string;
  email?: string;
  hasAuth?: boolean;
  departmentId?: string;
  departmentName?: string;
};

const dataDir = path.join(process.cwd(), "data");
const dataFilePath = path.join(dataDir, "students.json");

export const normalizeAdmission = (admissionNumber: string) => admissionNumber.trim().toUpperCase();

// Fetch all students from the database
export async function readStudents(departmentId?: string): Promise<StudentRecord[]> {
  const where = departmentId ? { departmentId } : {};
  const students = await prisma.student.findMany({ where, include: { auth: true } });
  return students.map((item) => ({
    id: item.id,
    name: item.name,
    admissionNumber: item.admissionNumber,
    courseId: item.courseId,
    institutionId: item.institutionId,
    email: item.auth?.email,
  }));
}

// Deprecated: Use Prisma create/update/delete methods directly for persistence
export async function writeStudents(students: StudentRecord[]): Promise<void> {
  throw new Error("writeStudents is deprecated. Use Prisma directly.");
}
