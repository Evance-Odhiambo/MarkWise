import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const perIpLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10 });
const perSessionLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// POST /api/attendance/sessions/:id/mark — public, requires admission number.
// Security: no session/student enumeration (uniform responses), IP + session rate limits.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const ipAllowed = await perIpLimiter(`mark:${clientIp}`);
  if (!ipAllowed.allowed) {
    return new NextResponse("Too many requests", { status: 429, headers: corsHeaders });
  }

  const { allowed: sessionAllowed } = await perSessionLimiter(id);
  if (!sessionAllowed) {
    return new NextResponse("Too many requests", { status: 429, headers: corsHeaders });
  }

  let body: { admissionNumber?: string };
  try {
    body = await req.json();
  } catch {
    return new NextResponse("Bad Request", { status: 400, headers: corsHeaders });
  }

  const admissionNumber = body.admissionNumber?.trim();
  if (!admissionNumber) {
    return new NextResponse("Bad Request", { status: 400, headers: corsHeaders });
  }

  await prisma.onlineAttendanceSession.updateMany({
    where: { status: "active", expiresAt: { lte: new Date() } },
    data: { status: "expired" },
  });

  const session = await prisma.onlineAttendanceSession.findFirst({
    where: { id, status: "active", expiresAt: { gt: new Date() } },
    select: { id: true },
  });

  if (!session) {
    return new NextResponse("Bad Request", { status: 400, headers: corsHeaders });
  }

  const student = await prisma.student.findFirst({
    where: { admissionNumber: { equals: admissionNumber, mode: "insensitive" } },
    select: { id: true },
  });

  if (!student) {
    return new NextResponse("Bad Request", { status: 400, headers: corsHeaders });
  }

  try {
    await prisma.onlineAttendanceRecord.create({
      data: {
        sessionId: session.id,
        studentId: student.id,
        admissionNumber: admissionNumber.toUpperCase(),
        unitCode: "",
      },
    });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return new NextResponse("Bad Request", { status: 400, headers: corsHeaders });
    }
    throw err;
  }

  return new NextResponse("OK", { status: 200, headers: corsHeaders });
}
