import { NextRequest, NextResponse } from "next/server";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { prisma } from "@/lib/prisma";
import { computeAndCachePoints } from "@/lib/gamificationEngine";

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

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export async function GET(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const token = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let studentId: string;
  let courseId: string | undefined;
  let institutionId: string | undefined;
  try {
    const payload = verifyStudentAccessToken(token);
    studentId = payload.studentId;
    courseId = payload.courseId;
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  // If JWT doesn't carry courseId/institutionId, look them up
  if (!courseId || !institutionId) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { courseId: true, institutionId: true },
    });
    if (!student) {
      return NextResponse.json({ message: "Student not found" }, { status: 404, headers: corsHeaders });
    }
    courseId = student.courseId;
    institutionId = student.institutionId;
  }

  // ── Query Params ──────────────────────────────────────────────────────────
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "institution" ? "institution" : "course";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    // ── Ensure current user has fresh cached points ───────────────────────
    await computeAndCachePoints(studentId);

    // ── Fetch ranked students from cache table ────────────────────────────
    const where = scope === "institution"
      ? { institutionId }
      : { courseId };

    const allPoints = await prisma.studentPoints.findMany({
      where,
      orderBy: { totalPoints: "desc" },
      select: {
        studentId: true,
        totalPoints: true,
        currentStreak: true,
        attendancePct: true,
        student: {
          select: { name: true },
        },
      },
    });

    // If we have fewer than 2 cached entries, we only have the current user.
    // That's fine — leaderboard will just be short.

    // ── Build ranked list ─────────────────────────────────────────────────
    const totalStudents = allPoints.length;

    type LeaderboardEntry = {
      rank: number;
      name: string;
      points: number;
      streak: number;
      percent: number;
      trend: string;
    };

    const ranked: LeaderboardEntry[] = allPoints.map((row, index) => ({
      rank: index + 1,
      name: privacyName(row.student.name),
      points: row.totalPoints,
      streak: row.currentStreak,
      percent: Math.round(row.attendancePct * 10) / 10,
      trend: "stable" as string, // trend computed below
    }));

    // ── Trend: compare to 7-day-old snapshot ──────────────────────────────
    // We use a simple heuristic: if student's points were computed within the
    // last 7 days, compare their rank now vs their previous position based on
    // a secondary sort by computedAt. For a production system, a weekly
    // snapshot table would be ideal. For now we mark stable.
    // Future enhancement: store weekly rank snapshots.

    // ── Find current user in ranking ──────────────────────────────────────
    const currentUserIndex = allPoints.findIndex((r) => r.studentId === studentId);
    const currentUserRank = currentUserIndex >= 0 ? currentUserIndex + 1 : totalStudents;
    const currentUserRow = currentUserIndex >= 0 ? allPoints[currentUserIndex] : null;

    const percentile = totalStudents > 0
      ? Math.round((1 - currentUserRank / totalStudents) * 100)
      : 0;

    const currentUser = {
      rank: currentUserRank,
      name: "You",
      points: currentUserRow?.totalPoints ?? 0,
      streak: currentUserRow?.currentStreak ?? 0,
      percent: currentUserRow ? Math.round(currentUserRow.attendancePct * 10) / 10 : 0,
      trend: "stable",
      totalStudents,
      percentile: Math.max(0, percentile),
    };

    // Top N
    const leaderboard = ranked.slice(0, limit);

    return NextResponse.json({ leaderboard, currentUser }, { headers: corsHeaders });
  } catch (err) {
    console.error("[leaderboard] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders },
    );
  }
}

/** "Alex Johnson" → "Alex J." — privacy-safe display name */
function privacyName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "Unknown";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
