/**
 * GET /api/student/delegations/me
 *
 * Returns all active (unused, within time window) delegations where
 * the authenticated student is the assigned group leader.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let studentId: string;
  let jwtPayload: ReturnType<typeof verifyStudentAccessToken> | null = null;
  try {
    jwtPayload = verifyStudentAccessToken(token);
    ({ studentId } = jwtPayload);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  const nowMs = BigInt(Date.now());

  const rows = await prisma.delegation.findMany({
    where: {
      leaderStudentId: studentId,
      used: false,
      validUntil: { gte: nowMs },
    },
    orderBy: { validFrom: "asc" },
  });

  const delegations = rows.map((d) => ({
    id: d.id,
    timetableEntryId: d.timetableEntryId,
    institutionId: d.institutionId ?? null,
    unitCode: d.unitCode,
    unitId: d.unitId,
    roomCode: d.roomCode,
    roomId: d.roomId,
    groupId: d.groupId,
    groupNumber: d.groupNumber,
    groupName: d.groupName,
    leaderStudentId: d.leaderStudentId,
    validFrom: Number(d.validFrom),
    validUntil: Number(d.validUntil),
    used: d.used,
    sessionToken: d.sessionToken ?? null,
    startedAt: d.startedAt?.toISOString() ?? null,
    createdAt: Number(d.createdAt),
  }));

  return NextResponse.json(delegations, { headers: corsHeaders });
}
