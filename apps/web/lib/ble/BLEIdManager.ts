// lib/ble/BLEIdManager.ts
import { prisma } from "@/lib/prisma";
import crypto from 'crypto';

export interface BLEIdRange {
  min: number;
  max: number;
  type: 'unit' | 'room';
  prefix?: string;
}

export interface BLEMapping {
  id: string;        // Now string (3-digit with optional prefix)
  numericId: number; // Keep numeric for efficient storage
  code: string;
  displayName: string;
  metadata?: any;
}

export interface ContextInfo {
  campus?: string;
  academicYear?: string;
  semester?: string;
}

export class BLEIdManager {
  // 4-digit ranges — units get the large allocation because universities
  // always have far more units (modules) than physical rooms.
  // UInt16 in the BLE compact packet supports 0-65535, so 4-digit IDs are fine.
  static readonly UNIT_RANGE: BLEIdRange = {
    min: 0,
    max: 7999,
    type: 'unit',
    prefix: 'U'
  };

  static readonly ROOM_RANGE: BLEIdRange = {
    min: 8000,
    max: 9999,
    type: 'room',
    prefix: 'R'
  };

  // Context-aware ID generation
  static readonly MAX_CONTEXTS = 100; // Support up to 100 campuses/years
  static readonly CONTEXT_MULTIPLIER = 1000; // Shift by 1000 for each context

  /**
   * Validate if an ID is in the correct range
   */
  static validateId(id: number, type: 'unit' | 'room', context?: ContextInfo): boolean {
    const range = type === 'unit' ? this.UNIT_RANGE : this.ROOM_RANGE;
    const contextOffset = this.getContextOffset(context);
    const adjustedMin = range.min + contextOffset;
    const adjustedMax = range.max + contextOffset;
    
    return id >= adjustedMin && id <= adjustedMax;
  }

  /**
   * Get context offset for multi-tenant support
   */
  static getContextOffset(context?: ContextInfo): number {
    if (!context?.campus && !context?.academicYear) return 0;
    
    // Generate deterministic offset based on context
    const contextString = `${context.campus || ''}-${context.academicYear || ''}-${context.semester || ''}`;
    const hash = crypto.createHash('md5').update(contextString).digest();
    const offset = (hash.readUInt32LE(0) % this.MAX_CONTEXTS) * this.CONTEXT_MULTIPLIER;
    
    return offset;
  }

  /**
   * Format ID for display (adds prefix and padding)
   */
  static formatId(id: number, type: 'unit' | 'room', context?: ContextInfo): string {
    const range = type === 'unit' ? this.UNIT_RANGE : this.ROOM_RANGE;
    const contextOffset = this.getContextOffset(context);
    const baseId = id - contextOffset;
    
    // Remove context offset for formatting
    const paddedId = baseId.toString().padStart(4, '0');
    return range.prefix ? `${range.prefix}${paddedId}` : paddedId;
  }

  /**
   * Parse formatted ID back to numeric
   */
  static parseId(formattedId: string, context?: ContextInfo): number | null {
    const match = formattedId.match(/^([UR]?)(\d{4})$/);
    if (!match) return null;
    
    const [, prefix, numStr] = match;
    const baseId = parseInt(numStr, 10);
    const contextOffset = this.getContextOffset(context);
    
    // Validate prefix if present
    if (prefix === 'U' && (baseId < this.UNIT_RANGE.min || baseId > this.UNIT_RANGE.max)) return null;
    if (prefix === 'R' && (baseId < this.ROOM_RANGE.min || baseId > this.ROOM_RANGE.max)) return null;
    
    return baseId + contextOffset;
  }

  /**
   * Generate a stable hash-based ID for fallback
   */
  static generateStableId(code: string, type: 'unit' | 'room', context?: ContextInfo): number {
    const hash = crypto.createHash('md5').update(code).digest();
    const hashNum = hash.readUInt32LE(0);
    const range = type === 'unit' ? this.UNIT_RANGE : this.ROOM_RANGE;
    const contextOffset = this.getContextOffset(context);
    
    const rangeSize = range.max - range.min + 1;
    const baseId = range.min + (hashNum % rangeSize);
    
    return baseId + contextOffset;
  }

  /**
   * Get next available unit ID
   */
  static async getNextUnitId(institutionId: string, context?: ContextInfo): Promise<number> {
    const contextOffset = this.getContextOffset(context);
    const min = this.UNIT_RANGE.min + contextOffset;
    const max = this.UNIT_RANGE.max + contextOffset;

    const usedIds = await prisma.unit.findMany({
      where: { 
        department: { institutionId },
        bleId: { not: null }
      },
      select: { bleId: true }
    });

    const usedSet = new Set(usedIds.map(u => u.bleId).filter((id): id is number => id !== null));
    
    for (let id = min; id <= max; id++) {
      if (!usedSet.has(id)) return id;
    }
    
    throw new Error(`No available unit BLE IDs in range ${min}-${max}`);
  }

  /**
   * Get next available room ID
   */
  static async getNextRoomId(institutionId: string, context?: ContextInfo): Promise<number> {
    const contextOffset = this.getContextOffset(context);
    const min = this.ROOM_RANGE.min + contextOffset;
    const max = this.ROOM_RANGE.max + contextOffset;

    const usedIds = await prisma.room.findMany({
      where: { 
        institutionId,
        bleId: { not: null }
      },
      select: { bleId: true }
    });

    const usedSet = new Set(usedIds.map(r => r.bleId).filter((id): id is number => id !== null));
    
    for (let id = min; id <= max; id++) {
      if (!usedSet.has(id)) return id;
    }
    
    throw new Error(`No available room BLE IDs in range ${min}-${max}`);
  }

  /**
   * Auto-assign IDs to all units and rooms in an institution
   */
  static async autoAssignIds(institutionId: string, context?: ContextInfo): Promise<{
    unitsAssigned: number;
    roomsAssigned: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let unitsAssigned = 0;
    let roomsAssigned = 0;

    const contextOffset = this.getContextOffset(context);
    const unitMin = this.UNIT_RANGE.min + contextOffset;
    const unitMax = this.UNIT_RANGE.max + contextOffset;
    const roomMin = this.ROOM_RANGE.min + contextOffset;
    const roomMax = this.ROOM_RANGE.max + contextOffset;

    // Get all units without valid IDs
    const units = await prisma.unit.findMany({
      where: { 
        department: { institutionId },
        OR: [
          { bleId: null },
          { NOT: { bleId: { gte: unitMin, lte: unitMax } } }
        ]
      },
      orderBy: { code: 'asc' }
    });

    // Assign unit IDs sequentially
    let nextUnitId = unitMin;
    for (const unit of units) {
      try {
        while (nextUnitId <= unitMax) {
          const existing = await prisma.unit.findFirst({
            where: { 
              bleId: nextUnitId,
              department: { institutionId },
              NOT: { id: unit.id }
            }
          });
          
          if (!existing) {
            await prisma.unit.update({
              where: { id: unit.id },
              data: { 
                bleId: nextUnitId,
                lastSyncAt: new Date(),
                syncVersion: { increment: 1 }
              }
            });
            unitsAssigned++;
            nextUnitId++;
            break;
          }
          nextUnitId++;
        }
      } catch (error) {
        errors.push(`Failed to assign ID to unit ${unit.code}: ${error}`);
      }
    }

    // Get all rooms without valid IDs
    const rooms = await prisma.room.findMany({
      where: { 
        institutionId,
        OR: [
          { bleId: null },
          { NOT: { bleId: { gte: roomMin, lte: roomMax } } }
        ]
      },
      orderBy: [{ buildingCode: 'asc' }, { roomCode: 'asc' }]
    });

    // Assign room IDs sequentially
    let nextRoomId = roomMin;
    for (const room of rooms) {
      try {
        while (nextRoomId <= roomMax) {
          const existing = await prisma.room.findFirst({
            where: { 
              bleId: nextRoomId,
              institutionId,
              NOT: { id: room.id }
            }
          });
          
          if (!existing) {
            await prisma.room.update({
              where: { id: room.id },
              data: { 
                bleId: nextRoomId,
                lastSyncAt: new Date(),
                syncVersion: { increment: 1 }
              }
            });
            roomsAssigned++;
            nextRoomId++;
            break;
          }
          nextRoomId++;
        }
      } catch (error) {
        errors.push(`Failed to assign ID to room ${room.roomCode}: ${error}`);
      }
    }

    return { unitsAssigned, roomsAssigned, errors };
  }

  /**
   * Calculate checksum for mappings
   */
  static calculateChecksum(data: any): string {
    const str = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash('md5').update(str).digest('hex');
  }

  /**
   * Get current BLE context from institution metadata.
   * Only reads the dedicated _bleContext key to avoid accidental offsets
   * from general metadata fields (campus, academicYear) used for other purposes.
   * To enable multi-campus offsets, set metadata._bleContext = { campus, academicYear }.
   */
  static async getInstitutionContext(institutionId: string): Promise<ContextInfo | null> {
    const institution = await prisma.institution.findUnique({
      where: { id: institutionId },
      select: { metadata: true }
    });

    if (!institution) return null;

    const metadata = institution.metadata as any;
    const bleCtx = metadata?._bleContext;
    if (!bleCtx) return null;

    return {
      campus: bleCtx.campus,
      academicYear: bleCtx.academicYear,
      semester: bleCtx.semester
    };
  }
}