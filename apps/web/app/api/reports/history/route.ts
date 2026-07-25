/**
 * GET /api/reports/history
 *
 * Returns the authenticated lecturer's past generated reports, newest first.
 *
 * Auth: Bearer <lecturerToken>
 * Query: ?limit=20&offset=0
 *
 * Response:
 * {
 *   reports: [{
 *     id, period, periodLabel, types, format,
 *     fileUrl, fileSizeBytes, generatedAt
 *   }],
 *   total: number
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const PERIOD_LABELS: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  semester: "Semester",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  // Auth
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401, headers: corsHeaders });
  }
  let lecturerId: string;
  try {
    ({ lecturerId } = verifyLecturerAccessToken(token));
  } catch {
    return NextResponse.json({ message: "Invalid or expired token." }, { status: 401, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10), 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10), 0);

  try {
    const [reports, total] = await Promise.all([
      prisma.lecturerReport.findMany({
        where: { lecturerId },
        orderBy: { generatedAt: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.lecturerReport.count({ where: { lecturerId } }),
    ]);

    return NextResponse.json(
      {
        reports: reports.map((r) => ({
          id: r.id,
          period: r.period,
          periodLabel: PERIOD_LABELS[r.period] ?? r.period,
          types: r.types,
          format: r.format,
          unitCodes: r.unitCodes,
          startDate: r.startDate?.toISOString().slice(0, 10) ?? null,
          endDate: r.endDate?.toISOString().slice(0, 10) ?? null,
          fileUrl: r.fileUrl ?? `/api/reports/${r.id}/download`,
          fileSizeBytes: r.fileSizeBytes,
          generatedAt: r.generatedAt.toISOString(),
        })),
        total,
      },
      { status: 200, headers: corsHeaders },
    );
  } catch (err) {
    console.error("[reports/history] error:", err);
    return NextResponse.json({ message: "Failed to fetch report history." }, { status: 500, headers: corsHeaders });
  }
}
