import { NextResponse } from "next/server";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * DELETE /api/auth/student/account
 * Hard-deletes the authenticated student's account and all related records.
 * Invalidates the current token by adding its jti to TokenBlocklist.
 */
export async function DELETE(request: Request) {
  const raw = request.headers.get("authorization") ?? "";
  const token = raw.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let studentId: string;
  let jti: string;
  let tokenExp: number;

  try {
    const payload = verifyStudentAccessToken(token);
    studentId = payload.studentId;
    jti = payload.jti;
    // "exp" is a standard JWT claim (seconds since epoch)
    tokenExp = (payload as any).exp ?? Math.floor(Date.now() / 1000) + 7 * 86400;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  // Verify the student actually exists in the DB (guards IDOR between token and DB)
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { id: true, name: true, institutionId: true },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404, headers: corsHeaders });
  }

  const ip =
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Invalidate the current token so it cannot be re-used
      await tx.tokenBlocklist.create({
        data: {
          jti,
          expiresAt: new Date(tokenExp * 1000),
        },
      });

      // 2. Delete StudentEnrollmentSnapshot (not covered by Student cascade)
      await tx.studentEnrollmentSnapshot.deleteMany({ where: { studentId } });

      // 3. Delete OfflineAttendanceRecord (no FK to Student — manual delete needed)
      await tx.offlineAttendanceRecord.deleteMany({ where: { studentId } });

      // 4. Hard-delete the student row.
      //    All cascade-delete relations fire here:
      //      AttendanceRecord, Enrollment, MaterialView, GroupMember,
      //      Submission, StudentPoints, StudentAuth, StudentPushToken,
      //      OnlineAttendanceRecord (via session cascade is partial — delete directly)
      await tx.onlineAttendanceRecord.deleteMany({ where: { studentId } });
      await tx.student.delete({ where: { id: studentId } });
    });

    // Audit log (outside the transaction — non-critical, do not roll back for this)
    console.info(
      JSON.stringify({
        event: "student.account.deleted",
        studentId,
        institutionId: student.institutionId,
        ip,
        timestamp: new Date().toISOString(),
      }),
    );

    return NextResponse.json({ message: "Account deleted" }, { headers: corsHeaders });
  } catch (err: any) {
    console.error("[DELETE /api/auth/student/account] Error:", err);
    return new NextResponse("Internal server error", {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }
}

