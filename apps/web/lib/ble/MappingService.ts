// lib/ble/MappingService.ts
import { prisma } from "@/lib/prisma";
import { BLEIdManager, ContextInfo } from './BLEIdManager';
import { normalizeUnitCode } from '@/lib/unitCode';

export interface MappingSet {
  version: string;
  context?: ContextInfo;
  unitMappings: Record<string, any>;
  roomMappings: Record<string, any>;
  reverseUnit: Record<string, string>;
  reverseRoom: Record<string, string>;
  normalizedUnit: Record<string, string>;
  normalizedRoom: Record<string, string>;
  unitRanges: {
    min: number;
    max: number;
    count: number;
  };
  roomRanges: {
    min: number;
    max: number;
    count: number;
  };
  checksum?: string;
}

export class MappingService {
  private static readonly CACHE_TTL = 3600; // 1 hour
  private static readonly MAPPING_VERSION_PREFIX = 'mapping:v3:';

  /**
   * Generate complete mapping set for an institution
   */
  static async generateMappingSet(institutionId: string): Promise<MappingSet> {
    // Ensure all units and rooms have BLE IDs before building the mapping set.
    // Without valid bleId values, the sync result would be empty.
    const context = await BLEIdManager.getInstitutionContext(institutionId);
    await BLEIdManager.autoAssignIds(institutionId, context).catch(() => {});
    const contextOffset = BLEIdManager.getContextOffset(context || undefined);

    // Fetch all units with their BLE IDs
    const units = await prisma.unit.findMany({
      where: {
        department: { institutionId },
        bleId: { not: null }
      },
      select: {
        bleId: true,
        code: true,
        title: true,
        department: { select: { name: true } }
      }
    });

    // Fetch all rooms with their BLE IDs
    const rooms = await prisma.room.findMany({
      where: {
        institutionId,
        bleId: { not: null }
      },
      select: {
        bleId: true,
        roomCode: true,
        name: true,
        buildingCode: true,
        floor: true,
        capacity: true
      }
    });

    // Build unit mappings with string IDs
    const unitMappings: Record<string, any> = {};
    const reverseUnit: Record<string, string> = {};
    const normalizedUnit: Record<string, string> = {};

    // A well-formed unit code has 2-6 letters immediately followed by digits
    // (with or without a space), e.g. "SCH 2170", "sch2170", "ENG 101".
    // Defined once outside the loop to avoid recompilation on every iteration.
    const CODE_PATTERN = /^[A-Za-z]{2,6}\s*\d+/;

    for (const u of units) {
      if (u.bleId == null) continue;

      // Format ID as 3-digit string with optional prefix
      const formattedId = BLEIdManager.formatId(u.bleId, 'unit', context || undefined);

      // Detect if DB fields are swapped:
      //   correct:  code="SCH 2170",        title="Organic Chemistry"
      //   swapped:  code="Organic Chemistry", title="SCH 2170"
      const dbCodeLooksLikeCode  = CODE_PATTERN.test(u.code  ?? '');
      const dbTitleLooksLikeCode = CODE_PATTERN.test(u.title ?? '');
      const fieldsAreSwapped = !dbCodeLooksLikeCode && dbTitleLooksLikeCode;

      const codeSource  = fieldsAreSwapped ? (u.title ?? u.code) : u.code;
      const titleSource = fieldsAreSwapped ? u.code : (u.title ?? u.code);

      // Canonicalise to "LETTERS SPACE DIGITS" ("SCH2170" → "SCH 2170"), idempotent.
      const canonicalCode = normalizeUnitCode(codeSource);
      const unitTitle     = titleSource.trim();

      // Normalised forms of the title — used for the disambiguation block in the
      // mobile app when it receives a BLE/QR payload that carries the display name
      // instead of the code (e.g. "ORGANICCHEMISTRY").
      const titleStripped = unitTitle.replace(/\s+/g, "").toUpperCase();

      unitMappings[formattedId] = {
        id: formattedId,
        numericId: u.bleId,
        rawCode: canonicalCode,       // ← ALWAYS the unit code  (e.g. "SCH 2170")
        displayName: unitTitle,        // ← ALWAYS the human label (e.g. "Organic Chemistry")
        department: u.department?.name,
        context: context,
        variations: [
          canonicalCode,
          canonicalCode.replace(/\s+/g, ''),
          canonicalCode.toUpperCase(),
          canonicalCode.replace(/\s+/g, '').toUpperCase(),
          canonicalCode.toLowerCase(),
          // Title variants — let the app find the mapping by display-name form too.
          unitTitle,
          titleStripped,
          unitTitle.toLowerCase(),
        ].filter(Boolean)
      };

      reverseUnit[formattedId] = canonicalCode;

      // Code-based lookup variants → canonical code
      const normalizedCode = canonicalCode.replace(/\s+/g, '').toUpperCase();
      normalizedUnit[normalizedCode]                                    = canonicalCode;
      normalizedUnit[canonicalCode.toLowerCase()]                       = canonicalCode;
      normalizedUnit[canonicalCode.replace(/\s+/g, '')]                = canonicalCode;
      normalizedUnit[canonicalCode.replace(/\s+/g, '').toLowerCase()]  = canonicalCode;

      // Title-based lookup variants → canonical code
      // Allows the app's disambiguation block to resolve "ORGANICCHEMISTRY" → "SCH 2170".
      if (titleStripped) {
        normalizedUnit[titleStripped]              = canonicalCode;
        normalizedUnit[unitTitle.toLowerCase().replace(/\s+/g, '')] = canonicalCode;
      }
    }

    const roomMappings: Record<string, any> = {};
    const reverseRoom: Record<string, string> = {};
    const normalizedRoom: Record<string, string> = {};

    for (const r of rooms) {
      if (r.bleId == null) continue;

      // Format ID as 3-digit string with optional prefix
      const formattedId = BLEIdManager.formatId(r.bleId, 'room', context || undefined);

      roomMappings[formattedId] = {
        id: formattedId,
        numericId: r.bleId,
        rawCode: r.roomCode,
        displayName: r.name || r.roomCode,
        building: r.buildingCode,
        floor: r.floor,
        capacity: r.capacity,
        context: context,
        variations: [
          r.roomCode,
          r.roomCode.replace(/\s+/g, ''),
          r.roomCode.toUpperCase(),
          r.roomCode.replace(/\s+/g, '').toUpperCase(),
          r.roomCode.toLowerCase(),
          `${r.buildingCode}${r.roomCode.replace(/\s+/g, '')}`
        ]
      };

      reverseRoom[formattedId] = r.roomCode;

      // Add normalized variations
      const normalized = r.roomCode.replace(/\s+/g, '').toUpperCase();
      normalizedRoom[normalized] = r.roomCode;
      normalizedRoom[r.roomCode.toLowerCase()] = r.roomCode;
      normalizedRoom[r.roomCode.replace(/\s+/g, '')] = r.roomCode;
      normalizedRoom[r.roomCode.replace(/\s+/g, '').toLowerCase()] = r.roomCode;
    }

    const version = new Date().toISOString();

    // Calculate ranges - FIX: pass correct type to parseId
    const unitIds = Object.keys(unitMappings)
      .map(id => BLEIdManager.parseId(id, context || undefined))
      .filter((id): id is number => id !== null);

    const roomIds = Object.keys(roomMappings)
      .map(id => BLEIdManager.parseId(id, context || undefined))
      .filter((id): id is number => id !== null);

    const mappingSet: MappingSet = {
      version,
      context: context || undefined,
      unitMappings,
      roomMappings,
      reverseUnit,
      reverseRoom,
      normalizedUnit,
      normalizedRoom,
      unitRanges: {
        min: unitIds.length > 0 ? Math.min(...unitIds) : BLEIdManager.UNIT_RANGE.min + contextOffset,
        max: unitIds.length > 0 ? Math.max(...unitIds) : BLEIdManager.UNIT_RANGE.min + contextOffset,
        count: unitIds.length
      },
      roomRanges: {
        min: roomIds.length > 0 ? Math.min(...roomIds) : BLEIdManager.ROOM_RANGE.min + contextOffset,
        max: roomIds.length > 0 ? Math.max(...roomIds) : BLEIdManager.ROOM_RANGE.min + contextOffset,
        count: roomIds.length
      }
    };

    mappingSet.checksum = BLEIdManager.calculateChecksum(mappingSet);

    return mappingSet;
  }

  /**
   * Save mapping set to database and cache.
   * roomId is nullable in InstitutionMappingSet - schema must allow null or a sentinel room must be used.
   * We store all mapping data in metadata and pass null for roomId (schema must be updated to allow null).
   */
  static async saveMappingSet(institutionId: string, mappingSet: MappingSet): Promise<void> {
    // Delete all previous snapshots for this institution before saving the new one.
    // This keeps the table lean and ensures getLatestMappingSet always returns fresh data.
    await prisma.institutionMappingSet.deleteMany({ where: { institutionId } });

    await prisma.institutionMappingSet.create({
      data: {
        institutionId,
        version: mappingSet.version,
        mappingKey: `${institutionId}-${mappingSet.version}`,
        metadata: {
          ...mappingSet,
          generatedAt: new Date().toISOString()
        } as any
      }
    });

    const contextKey = mappingSet.context
      ? `${mappingSet.context.campus || ''}-${mappingSet.context.academicYear || ''}`
      : 'default';
    const cacheKey = `${this.MAPPING_VERSION_PREFIX}${institutionId}:${contextKey}`;
    // Redis removed - add your cache implementation here using cacheKey
  }

  /**
   * Get latest mapping set with caching
   */
  static async getLatestMappingSet(
    institutionId: string,
    context?: ContextInfo
  ): Promise<MappingSet | null> {
    const contextKey = context
      ? `${context.campus || ''}-${context.academicYear || ''}`
      : 'default';
    const cacheKey = `${this.MAPPING_VERSION_PREFIX}${institutionId}:${contextKey}`;
    // Redis removed - check your cache here using cacheKey

    const whereClause: any = { institutionId };

    if (context) {
      whereClause.metadata = {
        path: ['context'],
        equals: context
      };
    }

    const latest = await prisma.institutionMappingSet.findFirst({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });

    if (!latest && context) {
      const anyLatest = await prisma.institutionMappingSet.findFirst({
        where: { institutionId },
        orderBy: { createdAt: 'desc' }
      });

      if (anyLatest) {
        return anyLatest.metadata as unknown as MappingSet;
      }
    }

    if (!latest) {
      return null;
    }

    return latest.metadata as unknown as MappingSet;
  }

  /**
   * Sync mapping set with version check
   */
  static async syncMappingSet(
    institutionId: string,
    clientVersion?: string,
    clientContext?: ContextInfo
  ): Promise<{
    mappingSet: MappingSet;
    needsFullSync: boolean;
    changes?: any;
  }> {
    const context = clientContext || await BLEIdManager.getInstitutionContext(institutionId) || undefined;

    const latest = await this.getLatestMappingSet(institutionId, context);

    if (!latest ||
        Object.keys(latest.unitMappings || {}).length === 0 ||
        Object.keys(latest.roomMappings || {}).length === 0) {
      // No snapshot or an empty snapshot exists — regenerate and save.
      const newSet = await this.generateMappingSet(institutionId);
      await this.saveMappingSet(institutionId, newSet);
      return { mappingSet: newSet, needsFullSync: true };
    }

    // Write routes (POST /api/rooms, /api/units, /api/rooms/bulk, /api/curriculum) always
    // call generateMappingSet + saveMappingSet immediately after any change, so the
    // snapshot is always current. No live count queries needed here.

    if (!clientVersion || clientVersion !== latest.version) {
      return { mappingSet: latest, needsFullSync: true };
    }

    return { mappingSet: latest, needsFullSync: false };
  }

  /**
   * Get mapping for specific ID
   */
  static async getMapping(
    institutionId: string,
    id: string,
    type: 'unit' | 'room'
  ): Promise<any | null> {
    const mappingSet = await this.getLatestMappingSet(institutionId);
    if (!mappingSet) return null;

    const mappings = type === 'unit' ? mappingSet.unitMappings : mappingSet.roomMappings;
    return mappings[id] || null;
  }

  /**
   * Resolve by raw code (fuzzy matching)
   */
  static async resolveByCode(
    institutionId: string,
    code: string,
    type: 'unit' | 'room'
  ): Promise<any | null> {
    const mappingSet = await this.getLatestMappingSet(institutionId);
    if (!mappingSet) return null;

    const normalized = code.replace(/\s+/g, '').toUpperCase();
    const normalizedMap = type === 'unit' ? mappingSet.normalizedUnit : mappingSet.normalizedRoom;

    const matchedCode = normalizedMap[normalized] ||
      normalizedMap[code.toLowerCase()] ||
      normalizedMap[code.replace(/\s+/g, '')];

    if (!matchedCode) return null;

    const mappings = type === 'unit' ? mappingSet.unitMappings : mappingSet.roomMappings;
    return Object.values(mappings).find((m: any) =>
      m.rawCode === matchedCode || m.rawCode.replace(/\s+/g, '') === matchedCode
    ) || null;
  }

  /**
   * Validate and repair mappings
   */
  static async validateAndRepair(institutionId: string): Promise<{
    valid: boolean;
    issues: string[];
    repaired: boolean;
  }> {
    const issues: string[] = [];
    let repaired = false;

    const context = await BLEIdManager.getInstitutionContext(institutionId) || undefined;

    // Check for duplicate unit BLE IDs
    const unitIds = await prisma.unit.groupBy({
      by: ['bleId'],
      where: {
        department: { institutionId },
        bleId: { not: null }
      },
      having: { bleId: { _count: { gt: 1 } } }
    });

    if (unitIds.length > 0) {
      issues.push(`Duplicate unit BLE IDs found: ${unitIds.map(u => u.bleId).join(', ')}`);
      await BLEIdManager.autoAssignIds(institutionId, context);
      repaired = true;
    }

    // Check for duplicate room BLE IDs
    const roomIds = await prisma.room.groupBy({
      by: ['bleId'],
      where: {
        institutionId,
        bleId: { not: null }
      },
      having: { bleId: { _count: { gt: 1 } } }
    });

    if (roomIds.length > 0) {
      issues.push(`Duplicate room BLE IDs found: ${roomIds.map(r => r.bleId).join(', ')}`);
      await BLEIdManager.autoAssignIds(institutionId, context);
      repaired = true;
    }

    const contextOffset = BLEIdManager.getContextOffset(context);

    const invalidUnits = await prisma.unit.count({
      where: {
        department: { institutionId },
        bleId: { not: null },
        NOT: {
          bleId: {
            gte: BLEIdManager.UNIT_RANGE.min + contextOffset,
            lte: BLEIdManager.UNIT_RANGE.max + contextOffset
          }
        }
      }
    });

    if (invalidUnits > 0) {
      issues.push(`${invalidUnits} units have out-of-range BLE IDs`);
      await BLEIdManager.autoAssignIds(institutionId, context);
      repaired = true;
    }

    const invalidRooms = await prisma.room.count({
      where: {
        institutionId,
        bleId: { not: null },
        NOT: {
          bleId: {
            gte: BLEIdManager.ROOM_RANGE.min + contextOffset,
            lte: BLEIdManager.ROOM_RANGE.max + contextOffset
          }
        }
      }
    });

    if (invalidRooms > 0) {
      issues.push(`${invalidRooms} rooms have out-of-range BLE IDs`);
      await BLEIdManager.autoAssignIds(institutionId, context);
      repaired = true;
    }

    return {
      valid: issues.length === 0,
      issues,
      repaired
    };
  }

  /**
   * Generate compact mapping for BLE transmission
   */
  static generateCompactMapping(mappingSet: MappingSet): Buffer {
    const units = Object.entries(mappingSet.unitMappings).map(([id, data]) => ({
      id: parseInt(id.replace(/[UR]/g, ''), 10),
      code: data.rawCode
    }));

    const rooms = Object.entries(mappingSet.roomMappings).map(([id, data]) => ({
      id: parseInt(id.replace(/[UR]/g, ''), 10),
      code: data.rawCode
    }));

    const buffer = Buffer.alloc(2 + units.length * 2 + rooms.length * 2);
    let offset = 0;

    buffer.writeUInt8(1, offset++); // version
    buffer.writeUInt8(units.length, offset++); // unit count

    units.forEach(u => {
      buffer.writeUInt16BE(u.id, offset);
      offset += 2;
    });

    rooms.forEach(r => {
      buffer.writeUInt16BE(r.id, offset);
      offset += 2;
    });

    return buffer;
  }
}