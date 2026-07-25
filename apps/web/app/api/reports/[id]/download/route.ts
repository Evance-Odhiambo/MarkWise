/**
 * GET /api/reports/[id]/download
 *
 * Streams the generated report file to the authenticated lecturer.
 * Returns 403 if the lecturer doesn't own the report, 404 if not found.
 *
 * Auth: Bearer <lecturerToken>
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const MIME: Record<string, string> = {
  pdf:   "application/pdf",
  csv:   "text/csv",
  excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const EXT: Record<string, string> = {
  pdf:   "pdf",
  csv:   "csv",
  excel: "xlsx",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

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

  // Resolve report
  const report = await prisma.lecturerReport.findUnique({ where: { id } });
  if (!report) {
    return NextResponse.json({ message: "Report not found." }, { status: 404, headers: corsHeaders });
  }
  if (report.lecturerId !== lecturerId) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403, headers: corsHeaders });
  }

  // Prefer the public Vercel Blob URL (new reports)
  if (report.fileUrl) {
    return NextResponse.redirect(report.fileUrl, { status: 302 });
  }

  // Legacy fallback: stream from local filePath
  if (!report.filePath || !fs.existsSync(report.filePath)) {
    return NextResponse.json(
      { message: "Report file not found. It may have expired — please regenerate." },
      { status: 404, headers: corsHeaders },
    );
  }

  const mimeType = MIME[report.format] ?? "application/octet-stream";
  const ext = EXT[report.format] ?? "bin";
  const filename = `markwise_report_${report.period}_${report.generatedAt.toISOString().slice(0, 10)}.${ext}`;

  const fileBuffer = fs.readFileSync(report.filePath);

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(fileBuffer.length),
    },
  });
}
