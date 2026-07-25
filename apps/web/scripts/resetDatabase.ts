/**
 * resetDatabase.ts
 * Empties every table in the database while preserving the schema.
 * Uses TRUNCATE … CASCADE so foreign-key order doesn't matter.
 *
 * Run with:
 *   npx tsx scripts/resetDatabase.ts
 *
 * You will be asked to type CONFIRM before anything is deleted.
 */

import { PrismaClient } from "@prisma/client";
import * as readline from "readline";

const prisma = new PrismaClient();

const TABLES = [
  "GroupMember",
  "GroupSubmission",
  "Submission",
  "MaterialView",
  "StudentPushToken",
  "BLESyncLog",
  "BookingHold",
  "Booking",
  "OnlineAttendanceRecord",
  "OnlineAttendanceSession",
  "AttendanceRecord",
  "OfflineAttendanceRecord",
  "ConductedSession",
  "ExtraSession",
  "MergedSession",
  "Delegation",
  "Enrollment",
  "StudentEnrollmentSnapshot",
  "StudentPoints",
  "StudentAuth",
  "LecturerAuth",
  "PasswordResetToken",
  "TokenBlocklist",
  "Notification",
  "LecturerNotification",
  "MeetingInvite",
  "UnitsByCourseYearSemester",
  "UnitsByYearSemester",
  "DepartmentUnit",
  "TimetableVersion",
  "Timetable",
  "MergedSession",
  "Assignment",
  "Material",
  "Group",
  "LecturerReport",
  "InstitutionMappingSet",
  "Unit",
  "Semester",
  "YearBlock",
  "Course",
  "Program",
  "FacilitiesManager",
  "Room",
  "Lecturer",
  "Student",
  "Admin",
  "Department",
  "Institution",
] as const;

async function confirm(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(
      '\n⚠️  This will DELETE ALL DATA from the production database.\nType "CONFIRM" to proceed, anything else to abort: ',
      answer => {
        rl.close();
        resolve(answer.trim() === "CONFIRM");
      },
    );
  });
}

async function main() {
  const ok = await confirm();
  if (!ok) {
    console.log("Aborted.");
    process.exit(0);
  }

  console.log("\nTruncating all tables…");

  // Build quoted table list — TRUNCATE … CASCADE handles FK order automatically
  const tableList = TABLES.map(t => `"${t}"`).join(", ");

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);

  console.log(`✓ ${TABLES.length} tables emptied. Schema is intact.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
