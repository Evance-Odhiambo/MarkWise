import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminOrLecturerScope } from "@/lib/adminLecturerAuth";
import { resolveAdminScope } from "@/lib/adminScope";
import { normalizeUnitCode } from "@/lib/unitCode";

/**
 * GET /api/attendance/sessions?institutionId=xxx
 *
 * Returns ConductedSession records for all units belonging to the given institution.
 * Auth: admin cookie/Bearer (institution-level role required).
 */
export async function GET(req: NextRequest) {
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const institutionId = scope.institutionId;
  if (!institutionId) {
    return NextResponse.json({ error: 'Your account is not linked to an institution.' }, { status: 403 });
  }

  // Find all unit codes that belong to departments in this institution
  const units = await prisma.unit.findMany({
    where: { department: { institutionId } },
    select: { code: true },
  });
  const unitCodes = units.map(u => u.code);

  const sessions = await prisma.conductedSession.findMany({
    where: unitCodes.length > 0 ? { unitCode: { in: unitCodes } } : { unitCode: 'NONE_MATCH' },
    orderBy: { sessionStart: 'desc' },
    take: 500,
  });

  return NextResponse.json({ sessions });
}

// POST /api/attendance/sessions — create a new online attendance session
export async function POST(req: NextRequest) {
  const scope = resolveAdminOrLecturerScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  let body: { lecturerId?: string; unitCode?: string; durationMs?: number; type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { lecturerId: bodyLecturerId, unitCode, durationMs, type = "online" } = body;

  if (!unitCode || typeof unitCode !== "string") {
    return NextResponse.json({ error: "unitCode is required" }, { status: 422 });
  }
  if (!durationMs || typeof durationMs !== "number" || durationMs <= 0) {
    return NextResponse.json({ error: "durationMs must be a positive number" }, { status: 422 });
  }

  // Identity always comes from JWT — never trust body for lecturerId
  const lecturerId = scope.userId;
  // If body supplied lecturerId (legacy), ensure it matches JWT
  if (bodyLecturerId && scope.role === "lecturer" && lecturerId !== bodyLecturerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const normalisedUnitCode = normalizeUnitCode(unitCode);
  const expiresAt = new Date(Date.now() + durationMs);

  const session = await prisma.onlineAttendanceSession.create({
    data: { lecturerId, unitCode: normalisedUnitCode, type, expiresAt },
  });

  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `${proto}://${host}`;
  const shareableLink = `${baseUrl}/attend?session=${session.id}`;

  return NextResponse.json({ sessionId: session.id, shareableLink }, { status: 201 });
}
