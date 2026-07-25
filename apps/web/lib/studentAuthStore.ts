import { prisma } from "@/lib/prisma";
import path from "node:path";

export type StudentAuthUser = {
  id: string;
  studentId: string;
  courseId?: string;
  admissionNumber: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

const dataDir = path.join(process.cwd(), "data");
const dataFilePath = path.join(dataDir, "studentAuthUsers.json");

const isStudentAuthUser = (value: unknown): value is StudentAuthUser => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.studentId === "string" &&
    (typeof item.courseId === "undefined" || typeof item.courseId === "string") &&
    typeof item.admissionNumber === "string" &&
    typeof item.email === "string" &&
    typeof item.passwordHash === "string" &&
    typeof item.createdAt === "string"
  );
};

// Fetch all student auth users from the database
export async function getStudentAuthUsers(): Promise<StudentAuthUser[]> {
  const users = await prisma.studentAuth.findMany({ include: { student: true } });
  return users.map((item) => ({
    id: item.id,
    studentId: item.studentId,
    courseId: item.student.courseId,
    admissionNumber: item.student.admissionNumber,
    email: item.email,
    passwordHash: item.passwordHash,
    createdAt: item.createdAt.toISOString(),
  }));
  // Removed extra closing brace to fix syntax error
}

// Deprecated: Use Prisma create/update/delete methods directly for persistence
export async function writeStudentAuthUsers(users: StudentAuthUser[]): Promise<void> {
  throw new Error("writeStudentAuthUsers is deprecated. Use Prisma directly.");
}
