import { prisma } from '@/lib/prisma';
import { BLEIdManager } from '@/lib/ble/BLEIdManager';

/**
 * Regenerates and saves the InstitutionMappingSet for the given institutionId.
 * This should be called after any change to units or rooms.
 */
export async function updateInstitutionMappingSet(institutionId: string) {
  const context = await BLEIdManager.getInstitutionContext(institutionId) || undefined;

  const units = await prisma.unit.findMany({
    where: { department: { institutionId } },
    select: { bleId: true, code: true, title: true },
  });
  const rooms = await prisma.room.findMany({
    where: { institutionId },
    select: { bleId: true, roomCode: true, name: true, buildingCode: true, floor: true },
  });

  // Build mappings using 3-digit prefixed string IDs
  const unitMappings: Record<string, any> = {};
  const reverseUnit: Record<string, string> = {};
  const normalizedUnit: Record<string, string> = {};
  for (const u of units) {
    if (u.bleId == null) continue;
    const key = BLEIdManager.formatId(u.bleId, 'unit', context);
    unitMappings[key] = { id: key, numericId: u.bleId, rawCode: u.code, displayName: u.title };
    reverseUnit[key] = u.code;
    normalizedUnit[u.code.replace(/\s+/g, '').toUpperCase()] = u.code;
    normalizedUnit[u.code.trim().toLowerCase()] = u.code;
  }

  const roomMappings: Record<string, any> = {};
  const reverseRoom: Record<string, string> = {};
  const normalizedRoom: Record<string, string> = {};
  for (const r of rooms) {
    if (r.bleId == null) continue;
    const key = BLEIdManager.formatId(r.bleId, 'room', context);
    roomMappings[key] = { id: key, numericId: r.bleId, rawCode: r.roomCode, displayName: r.name, building: r.buildingCode, floor: r.floor };
    reverseRoom[key] = r.roomCode;
    normalizedRoom[r.roomCode.replace(/\s+/g, '').toUpperCase()] = r.roomCode;
  }

  const version = new Date().toISOString();
  const mappingKey = `${institutionId}-${version}`;
  await prisma.institutionMappingSet.create({
    data: {
      institutionId,
      version,
      mappingKey,
      metadata: {
        unitMappings,
        roomMappings,
        reverseUnit,
        reverseRoom,
        normalizedUnit,
        normalizedRoom,
      },
    }
  });
}
