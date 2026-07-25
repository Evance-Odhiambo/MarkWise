/**
 * scripts/migrateUnitCodes.ts
 *
 * One-time migration: normalise every stored unit code to the canonical format
 * "LETTERS NUMBERS" (e.g. "SCH2170" → "SCH 2170", "sch 2170" → "SCH 2170").
 *
 * Runs inside a single DB transaction so the whole migration rolls back if
 * anything fails — no table will be left in a partial state.
 *
 * Tables updated (in dependency order):
 *   1. Unit                      — source of truth
 *   2. Group                     — unitCode column (denormalised)
 *   3. OnlineAttendanceSession   — unitCode column
 *   4. OnlineAttendanceRecord    — unitCode column
 *   5. ConductedSession          — unitCode column (part of unique constraint)
 *   6. OfflineAttendanceRecord   — unitCode column (part of unique constraint)
 *   7. Delegation                — unitCode column
 *   8. MeetingInvite             — unitCode column
 *   9. ExtraSession              — unitCode column
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/migrateUnitCodes.ts
 *   # or using tsx:
 *   npx tsx scripts/migrateUnitCodes.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Canonical format: UPPER(ALPHA) + " " + DIGIT+... */
function normalizeUnitCode(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  const m = s.match(/^([A-Z]+)(\d+.*)$/);
  if (m) return `${m[1]} ${m[2]}`;
  return s;
}

async function main() {
  console.log("[migrateUnitCodes] Starting …");

  // ── 1. Collect all Unit rows ──────────────────────────────────────────────
  const units = await prisma.unit.findMany({ select: { id: true, code: true } });

  // Build old→new mapping (only rows that actually need changing)
  const codeMap = new Map<string, string>(); // oldCode → newCode
  for (const u of units) {
    const canonical = normalizeUnitCode(u.code);
    if (canonical !== u.code) {
      codeMap.set(u.code, canonical);
    }
  }

  console.log(
    `[migrateUnitCodes] ${units.length} unit rows scanned, ${codeMap.size} need normalisation.`
  );

  if (codeMap.size === 0) {
    console.log("[migrateUnitCodes] Nothing to do. All unit codes are already canonical.");
    return;
  }

  // ── 2. Run all updates in one transaction ─────────────────────────────────
  await prisma.$transaction(
    async (tx) => {
      let totalUpdated = 0;

      for (const [oldCode, newCode] of codeMap) {
        console.log(`  [Unit] "${oldCode}" → "${newCode}"`);

        // 2a. Unit table — update code
        await tx.unit.updateMany({
          where: { code: oldCode },
          data: { code: newCode },
        });

        // 2b. Group.unitCode (denormalised)
        const grpResult = await tx.group.updateMany({
          where: { unitCode: oldCode },
          data: { unitCode: newCode },
        });

        // 2c. OnlineAttendanceSession.unitCode
        await tx.onlineAttendanceSession.updateMany({
          where: { unitCode: oldCode },
          data: { unitCode: newCode },
        });

        // 2d. OnlineAttendanceRecord.unitCode
        await tx.onlineAttendanceRecord.updateMany({
          where: { unitCode: oldCode },
          data: { unitCode: newCode },
        });

        // 2e. ConductedSession.unitCode
        // ConductedSession has @@unique([unitCode, lectureRoom, sessionStart]).
        // Multiple rows can share the same unitCode but differ on lectureRoom/sessionStart,
        // so updateMany is safe here.
        await tx.conductedSession.updateMany({
          where: { unitCode: oldCode },
          data: { unitCode: newCode },
        });

        // 2f. OfflineAttendanceRecord.unitCode
        // Has @@unique([studentId, unitCode, lectureRoom, sessionStart]).
        // Can't do updateMany if rows would collide after the rename — but since we're
        // only changing the code, not student/room/time, no collision is possible.
        await tx.offlineAttendanceRecord.updateMany({
          where: { unitCode: oldCode },
          data: { unitCode: newCode },
        });

        // 2g. Delegation.unitCode
        await tx.delegation.updateMany({
          where: { unitCode: oldCode },
          data: { unitCode: newCode },
        });

        // 2h. MeetingInvite.unitCode
        await tx.meetingInvite.updateMany({
          where: { unitCode: oldCode },
          data: { unitCode: newCode },
        });

        // 2i. ExtraSession.unitCode
        await tx.extraSession.updateMany({
          where: { unitCode: oldCode },
          data: { unitCode: newCode },
        });

        totalUpdated++;
      }

      console.log(`[migrateUnitCodes] Transaction complete. ${totalUpdated} unit codes migrated.`);
    },
    {
      // Give the transaction enough time for large datasets.
      timeout: 120_000, // 2 minutes
    }
  );

  // ── 3. Verify ─────────────────────────────────────────────────────────────
  const remaining = await prisma.unit.findMany({
    select: { id: true, code: true },
    where: {
      NOT: {
        code: {
          // A canonical code always has exactly one space between letters and digits.
          // Prisma doesn't support regex in where, so we fetch all and filter in JS.
          contains: " ",
        },
      },
    },
  });
  const stillBad = remaining.filter((u) => normalizeUnitCode(u.code) !== u.code);
  if (stillBad.length > 0) {
    console.warn(
      `[migrateUnitCodes] WARNING: ${stillBad.length} unit(s) still have non-canonical codes:`,
      stillBad.map((u) => u.code)
    );
  } else {
    console.log("[migrateUnitCodes] ✓ All unit codes are now canonical.");
  }
}

main()
  .catch((err) => {
    console.error("[migrateUnitCodes] FATAL:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
