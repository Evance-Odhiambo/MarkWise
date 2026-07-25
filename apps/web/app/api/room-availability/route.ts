import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError, optionsResponse } from "@/lib/roomApi";

// GET /api/room-availability
export async function GET(req: NextRequest) {
  try {
    // Query the RoomAvailability view
    const availability = await prisma.$queryRawUnsafe(
      `SELECT * FROM "RoomAvailability"`
    );
    return jsonOk(availability);
  } catch (error) {
    return jsonError(error);
  }
}

// OPTIONS handler for CORS preflight
export function OPTIONS() {
  return optionsResponse();
}
