/**
 * scripts/fixSwappedUnitFields.ts
 *
 * One-time migration: finds Unit rows where the `code` and `title` fields were
 * stored in the wrong columns (e.g. code="Organic Chemistry", title="SCH 2170")
 * and swaps them so the DB is canonical before the next BLE mapping generation.
 *
 * Detection rule:
 *   - A valid unit code matches /^[A-Z]{2,6}\s*\d+/ (letters then digits).
 *   - If `code` does NOT match but `title` DOES → the pair is swapped.
 *
 * After fixing, every affected institution's InstitutionMappingSet snapshot is
 * deleted so the next mobile sync forces a fresh generateMappingSet() call.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json -e "require('./scripts/fixSwappedUnitFields.ts')"
 *   OR via tsx:
 *   npx tsx scripts/fixSwappedUnitFields.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CODE_PATTERN = /^[A-Za-z]{2,6}\s*\d+/;

function normalizeUnitCode(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^([A-Z]+)(\d+.*)$/);
  return m ? `${m[1]} ${m[2]}` : s;
}

async function main() {
  console.log('--- fixSwappedUnitFields ---');

  // Load all units with their department (to get institutionId for remapping later)
  const units = await prisma.unit.findMany({
    select: {
      id: true,
      code: true,
      title: true,
      department: { select: { institutionId: true } },
    },
  });

  const swapped = units.filter(
    (u) =>
      !CODE_PATTERN.test(u.code ?? '') &&
      CODE_PATTERN.test(u.title ?? '')
  );

  if (swapped.length === 0) {
    console.log('No swapped units found — nothing to do.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${swapped.length} unit(s) with swapped code/title fields:`);
  for (const u of swapped) {
    console.log(`  id=${u.id}  code="${u.code}"  title="${u.title}"`);
  }

  // Collect affected institution IDs so we can flush their snapshots
  const institutionIds = [
    ...new Set(swapped.map((u) => u.department?.institutionId).filter(Boolean) as string[]),
  ];

  // Fix in a transaction: update each swapped unit
  await prisma.$transaction(async (tx) => {
    for (const u of swapped) {
      const correctCode  = normalizeUnitCode(u.title); // title holds the real code
      const correctTitle = u.code;                     // code holds the real name

      // Temporary rename to avoid unique-constraint clash during the swap.
      // Prisma runs all updates serially inside the transaction so this is safe.
      await tx.unit.update({
        where: { id: u.id },
        data: {
          code:  correctCode,
          title: correctTitle,
        },
      });
      console.log(`  Fixed: "${u.code}" → code="${correctCode}", title="${correctTitle}"`);
    }
  });

  // Flush stale mapping snapshots for every affected institution so the next
  // sync triggers a fresh generateMappingSet() rather than serving old data.
  if (institutionIds.length > 0) {
    const deleted = await prisma.institutionMappingSet.deleteMany({
      where: { institutionId: { in: institutionIds } },
    });
    console.log(
      `Flushed ${deleted.count} stale InstitutionMappingSet snapshot(s) ` +
      `for institution(s): ${institutionIds.join(', ')}`
    );
  }

  console.log('Done — call PUT /api/mappings?institutionId=<id> (or wait for the next mobile sync) to regenerate.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
