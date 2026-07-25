import { prisma } from "@/lib/prisma";
import path from "path";

export type LecturerAccount = {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  department?: string;
  institutionId?: string;
  passwordHash: string;
  createdAt: string;
};

const dataDir = path.join(process.cwd(), "data");
const dataFilePath = path.join(dataDir, "lecturerAuthUsers.json");

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const normalizePhone = (phone: string) => phone.replace(/\s+/g, "").trim();

const isLecturerAccount = (value: unknown): value is LecturerAccount => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;

  return (
    typeof item.id === "string" &&
    typeof item.fullName === "string" &&
    typeof item.email === "string" &&
    typeof item.phoneNumber === "string" &&
    (typeof item.department === "undefined" || typeof item.department === "string") &&
    typeof item.passwordHash === "string" &&
    typeof item.createdAt === "string"
  );
};

// Fetch all lecturers from the database
export async function readLecturerAccounts(): Promise<LecturerAccount[]> {
  const lecturers = await prisma.lecturer.findMany();
  // Map to LecturerAccount type for compatibility
  return lecturers.map((item) => ({
    id: item.id,
    fullName: item.fullName,
    email: item.email,
    phoneNumber: item.phoneNumber ?? "",
    department: (item as any).departmentId ?? undefined,
    institutionId: item.institutionId ?? undefined,
    passwordHash: item.passwordHash,
    createdAt: item.createdAt.toISOString(),
  }));
}

// Deprecated: Use Prisma create/update/delete methods directly for persistence
export async function writeLecturerAccounts(accounts: LecturerAccount[]): Promise<void> {
  throw new Error("writeLecturerAccounts is deprecated. Use Prisma directly.");
}
