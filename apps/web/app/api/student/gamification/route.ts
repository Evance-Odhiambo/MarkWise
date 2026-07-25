import { NextResponse } from "next/server";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { computeAndCachePoints } from "@/lib/gamificationEngine";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// Serve cached data if computed within the last hour; recompute otherwise.
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let studentId: string;
  try {
    const payload = verifyStudentAccessToken(token);
    studentId = payload.studentId;
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  try {
    // Check cache first
    const cached = await prisma.studentPoints.findUnique({
      where: { studentId },
      select: { statsJson: true, breakdownJson: true, totalPoints: true, computedAt: true },
    });

    const isFresh = cached && Date.now() - cached.computedAt.getTime() < CACHE_TTL_MS;

    if (isFresh && cached.statsJson && cached.breakdownJson) {
      // Serve from cache — still need recentActivity from live data
      const result = await computeAndCachePoints(studentId);
      return NextResponse.json(result, { headers: corsHeaders });
    }

    // Compute fresh
    const result = await computeAndCachePoints(studentId);
    return NextResponse.json(result, { headers: corsHeaders });
  } catch (err) {
    console.error("[gamification] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders },
    );
  }
}
