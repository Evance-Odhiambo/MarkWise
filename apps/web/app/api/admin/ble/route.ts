// app/api/admin/ble/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "lib/prisma";
import { BLEIdManager } from "lib/ble/BLEIdManager";
import { MappingService } from "lib/ble/MappingService";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const institutionId = searchParams.get("institutionId");

    if (!institutionId) {
      return NextResponse.json({ error: "Missing institutionId" }, { status: 400 });
    }

    // Get all units with their BLE info
    const units = await prisma.unit.findMany({
      where: { department: { institutionId } },
      select: {
        id: true,
        code: true,
        title: true,
        bleId: true,
        lastSyncAt: true,
        syncVersion: true,
        department: { select: { name: true } }
      },
      orderBy: { code: 'asc' }
    });

    // Get all rooms with their BLE info
    const rooms = await prisma.room.findMany({
      where: { institutionId },
      select: {
        id: true,
        roomCode: true,
        name: true,
        buildingCode: true,
        floor: true,
        bleId: true,
        lastSyncAt: true,
        syncVersion: true
      },
      orderBy: [{ buildingCode: 'asc' }, { roomCode: 'asc' }]
    });

    // Calculate stats
    const unitStats = {
      total: units.length,
      withIds: units.filter(u => u.bleId).length,
      withoutIds: units.filter(u => !u.bleId).length,
      validIds: units.filter(u => u.bleId && BLEIdManager.validateId(u.bleId, 'unit')).length,
      invalidIds: units.filter(u => u.bleId && !BLEIdManager.validateId(u.bleId, 'unit')).length,
      range: BLEIdManager.UNIT_RANGE
    };

    const roomStats = {
      total: rooms.length,
      withIds: rooms.filter(r => r.bleId).length,
      withoutIds: rooms.filter(r => !r.bleId).length,
      validIds: rooms.filter(r => r.bleId && BLEIdManager.validateId(r.bleId, 'room')).length,
      invalidIds: rooms.filter(r => r.bleId && !BLEIdManager.validateId(r.bleId, 'room')).length,
      range: BLEIdManager.ROOM_RANGE
    };

    // Get recent sync logs
    const syncLogs = await prisma.bLESyncLog.findMany({
      where: { institutionId },
      orderBy: { startedAt: 'desc' },
      take: 50
    });

    return NextResponse.json({
      success: true,
      stats: { units: unitStats, rooms: roomStats },
      units: units.map(u => ({
        ...u,
        idValid: u.bleId ? BLEIdManager.validateId(u.bleId, 'unit') : false
      })),
      rooms: rooms.map(r => ({
        ...r,
        idValid: r.bleId ? BLEIdManager.validateId(r.bleId, 'room') : false
      })),
      syncLogs
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { institutionId, action } = await req.json();

    if (!institutionId) {
      return NextResponse.json({ error: "Missing institutionId" }, { status: 400 });
    }

    switch (action) {
      case 'auto-assign':
        const assignment = await BLEIdManager.autoAssignIds(institutionId);
        
        // Generate new mappings after assignment
        const mappingSet = await MappingService.generateMappingSet(institutionId);
        await MappingService.saveMappingSet(institutionId, mappingSet);
        
        return NextResponse.json({
          success: true,
          message: `Assigned ${assignment.unitsAssigned} units and ${assignment.roomsAssigned} rooms`,
          details: assignment
        });

      case 'validate':
        const validation = await MappingService.validateAndRepair(institutionId);
        return NextResponse.json({
          success: true,
          ...validation
        });

      case 'reset':
        // Reset all BLE IDs
        await prisma.unit.updateMany({
          where: { department: { institutionId } },
          data: { bleId: null, syncVersion: 0 }
        });
        
        await prisma.room.updateMany({
          where: { institutionId },
          data: { bleId: null, syncVersion: 0 }
        });

        // Generate new mappings
        const newSet = await MappingService.generateMappingSet(institutionId);
        await MappingService.saveMappingSet(institutionId, newSet);

        return NextResponse.json({
          success: true,
          message: "All BLE IDs reset and regenerated"
        });

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}