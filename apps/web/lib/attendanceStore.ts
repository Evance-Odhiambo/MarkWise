
import { prisma } from "@/lib/prisma";

export type AttendanceFlagReason = "NO_MOTION";

export type AttendanceRecord = {
  id: string;
  studentId: string;
  admissionNumber: string;
  unitCode: string;
  lectureRoom: string;
  sessionStart: string;
  deviceId: string;
  rawPayload: unknown;
  motionVerified: boolean;
  motionObservedAt: string;
  motionScore?: number;
  flagged: boolean;
  reason?: AttendanceFlagReason;
  riskScore: number;
  createdAt: string;
};



const isAttendanceRecord = (value: unknown): value is AttendanceRecord => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.studentId === "string" &&
    typeof item.admissionNumber === "string" &&
    typeof item.unitCode === "string" &&
    typeof item.lectureRoom === "string" &&
    typeof item.sessionStart === "string" &&
    typeof item.deviceId === "string" &&
    typeof item.motionVerified === "boolean" &&
    typeof item.motionObservedAt === "string" &&
    typeof item.flagged === "boolean" &&
    typeof item.riskScore === "number" &&
    typeof item.createdAt === "string"
  );
};

// Fetch attendance records from the database and map to AttendanceRecord type
export async function getAttendanceRecords(): Promise<AttendanceRecord[]> {
  const records = await prisma.attendanceRecord.findMany();
  return records.map((rec) => ({
    id: rec.id,
    studentId: rec.studentId,
    admissionNumber: '', // Not in DB, add join if needed
    unitCode: '', // Not in DB, add join if needed
    lectureRoom: rec.roomId, // Or join Room for name
    sessionStart: rec.date.toISOString(),
    deviceId: '', // Not in DB
    rawPayload: undefined, // Not in DB
    motionVerified: false, // Not in DB
    motionObservedAt: '', // Not in DB
    motionScore: undefined, // Not in DB
    flagged: false, // Not in DB
    reason: undefined, // Not in DB
    riskScore: 0, // Not in DB
    createdAt: rec.createdAt.toISOString(),
  }));
}

