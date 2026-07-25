/**
 * POST /api/attendance/delegations/:id/start
 *
 * Group leader starts their delegated GD session.
 * Issues a signed JWT session token stored in the delegation row.
 * Idempotent: returns 409 if the session is already started.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import jwt from "jsonwebtoken";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaders });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let studentId: string;
  try {
    ({ studentId } = verifyStudentAccessToken(token));
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  const { id } = await context.params;

  // ── Fetch delegation ──────────────────────────────────────────────────────
  const delegation = await prisma.delegation.findUnique({ where: { id } });

  if (!delegation) {
    return NextResponse.json({ error: "Delegation not found" }, { status: 404, headers: corsHeaders });
  }

  if (delegation.leaderStudentId !== studentId) {
    return NextResponse.json(
      { error: "Forbidden: you are not the assigned leader for this delegation" },
      { status: 403, headers: corsHeaders },
    );
  }

  // ── Idempotent guard ─────────────────────────────────────────────────────
  // If the session was already started (sessionToken set) or fully completed
  // (used=true), return the stored token instead of an error. This covers the
  // offline-sync scenario where the client retries /start after connectivity
  // is restored, or where /start and /end were both queued and /end arrives
  // out of order then /start is retried.
  if (delegation.sessionToken || delegation.used) {
    return NextResponse.json(
      { sessionToken: delegation.sessionToken, startedAt: delegation.startedAt?.toISOString() ?? null },
      { headers: corsHeaders },
    );
  }

  // ── Time-window check ─────────────────────────────────────────────────────
  const nowMs = Date.now();
  const validFrom = Number(delegation.validFrom);
  const validUntil = Number(delegation.validUntil);

  if (nowMs > validUntil) {
    return NextResponse.json(
      { error: "Delegation time window has expired" },
      { status: 410, headers: corsHeaders },
    );
  }

  // ── Issue session token ───────────────────────────────────────────────────
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500, headers: corsHeaders });
  }

  const sessionTokenPayload = {
    delegationId: delegation.id,
    unitCode: delegation.unitCode,
    groupId: delegation.groupId,
    issuedAt: nowMs,
  };

  const expiresInSeconds = Math.ceil((validUntil - nowMs) / 1000);
  const sessionToken = jwt.sign(sessionTokenPayload, jwtSecret, { expiresIn: expiresInSeconds });

  const startedAt = new Date();

  await prisma.delegation.update({
    where: { id },
    data: { sessionToken, startedAt },
  });

  return NextResponse.json(
    { sessionToken, startedAt: startedAt.toISOString() },
    { headers: corsHeaders },
  );
}
