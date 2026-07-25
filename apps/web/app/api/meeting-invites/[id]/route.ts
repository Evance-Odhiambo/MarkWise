import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// DELETE /api/meeting-invites/:id
// Auth: Lecturer JWT required — only the owning lecturer may delete
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let lecturerId: string;
  try {
    const payload = verifyLecturerAccessToken(token);
    lecturerId = payload.lecturerId;
  } catch {
    return NextResponse.json({ message: "Invalid or expired token" }, { status: 401, headers: corsHeaders });
  }

  const { id } = await params;

  const invite = await prisma.meetingInvite.findUnique({
    where: { id },
    select: { lecturerId: true },
  });

  if (!invite) {
    return NextResponse.json({ message: "Invite not found" }, { status: 404, headers: corsHeaders });
  }

  if (invite.lecturerId !== lecturerId) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403, headers: corsHeaders });
  }

  await prisma.meetingInvite.delete({ where: { id } });

  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
