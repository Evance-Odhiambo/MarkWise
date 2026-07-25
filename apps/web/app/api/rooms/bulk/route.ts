import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MappingService } from "@/lib/ble/MappingService";
import { BLEIdManager } from "@/lib/ble/BLEIdManager";
import { resolveRoomScope } from "@/lib/roomAuth";

export async function POST(request: Request) {
  try {
    const scope = await resolveRoomScope(request);
    if (!scope.ok) {
      return NextResponse.json({ error: { message: scope.error } }, { status: scope.status });
    }
    if (scope.role !== "facilitiesManager" && scope.role !== "admin") {
      return NextResponse.json({ error: { message: "Only room managers or admins can create rooms." } }, { status: 403 });
    }
    const { rooms } = await request.json();
    if (!Array.isArray(rooms) || rooms.length === 0) {
      return NextResponse.json({ error: { message: "No rooms provided." } }, { status: 400 });
    }
    // Validate each room (basic validation)
    for (const room of rooms) {
      if (!room.buildingCode || !room.roomCode || !room.name || !room.capacity || !room.type) {
        return NextResponse.json({ error: { message: "Missing required room fields." } }, { status: 400 });
      }
    }
    // Assign BLE IDs in the correct range (R200–R999), scoped to this institution
    const institutionId = rooms[0]?.institutionId;
    const usedBleRows = institutionId
      ? await prisma.room.findMany({
          where: { institutionId, bleId: { not: null } },
          select: { bleId: true },
        })
      : [];
    const usedBleSet = new Set(
      usedBleRows.map((r) => r.bleId).filter((id): id is number => id !== null),
    );
    const availableIds: number[] = [];
    for (
      let id = BLEIdManager.ROOM_RANGE.min;
      id <= BLEIdManager.ROOM_RANGE.max && availableIds.length < rooms.length;
      id++
    ) {
      if (!usedBleSet.has(id)) availableIds.push(id);
    }
    if (availableIds.length < rooms.length) {
      return NextResponse.json(
        { error: { message: `Not enough BLE IDs available in range R${BLEIdManager.ROOM_RANGE.min}–R${BLEIdManager.ROOM_RANGE.max}.` } },
        { status: 422 },
      );
    }
    const roomsWithBle = rooms.map((room: any, i: number) => ({ ...room, bleId: availableIds[i] }));
    // Bulk create rooms
    const created = await prisma.room.createMany({
      data: roomsWithBle,
      skipDuplicates: true,
    });
    if (institutionId) {
      await BLEIdManager.autoAssignIds(institutionId);
      const mappingSet = await MappingService.generateMappingSet(institutionId);
      await MappingService.saveMappingSet(institutionId, mappingSet);
    }
    return NextResponse.json({ data: { count: created.count } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: { message: "Failed to create rooms." } }, { status: 500 });
  }
}
