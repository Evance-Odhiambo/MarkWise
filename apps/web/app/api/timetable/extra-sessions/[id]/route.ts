/**
 * DELETE /api/timetable/extra-sessions/:id
 *
 * Soft-deletes a make-up session (sets deleted_at = NOW()).
 * Only the lecturer who created the session may delete it.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let lecturerId: string;
  try {
    const payload = verifyLecturerAccessToken(token);
    lecturerId = payload.lecturerId;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const { id } = await params;

  // Fetch matching active session
  const session = await prisma.extraSession.findUnique({
    where: { id },
    select: { id: true, lecturerId: true, deletedAt: true },
  });

  if (!session || session.deletedAt !== null) {
    return NextResponse.json({ error: "Session not found" }, { status: 404, headers: corsHeaders });
  }

  if (session.lecturerId !== lecturerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders });
  }

  await prisma.extraSession.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ message: "Make-up session removed" }, { headers: corsHeaders });
}
