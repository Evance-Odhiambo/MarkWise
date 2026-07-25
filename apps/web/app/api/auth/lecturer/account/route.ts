import { NextResponse } from "next/server";
import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
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
 * DELETE /api/auth/lecturer/account
 * Hard-deletes the authenticated lecturer's account and all related records.
 * Invalidates the current token by adding its jti to TokenBlocklist (when present).
 */
export async function DELETE(request: Request) {
  const raw = request.headers.get("authorization") ?? "";
  const token = raw.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  let lecturerId: string;
  let jti: string | undefined;
  let tokenExp: number;

  try {
    const payload = verifyLecturerAccessToken(token);
    lecturerId = payload.lecturerId;
    jti = payload.jti || undefined;
    tokenExp = (payload as any).exp ?? Math.floor(Date.now() / 1000) + 7 * 86400;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  // Verify the lecturer actually exists in the DB (guards IDOR between token and DB)
  const lecturer = await prisma.lecturer.findUnique({
    where: { id: lecturerId },
    select: { id: true, fullName: true, institutionId: true },
  });

  if (!lecturer) {
    return NextResponse.json({ error: "Lecturer not found" }, { status: 404, headers: corsHeaders });
  }

  const ip =
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Invalidate the current JWT so it cannot be re-used after deletion.
      //    Only possible when the token carries a jti claim (tokens issued after this
      //    change always will; older tokens are gracefully skipped).
      if (jti) {
        await tx.tokenBlocklist.create({
          data: {
            jti,
            expiresAt: new Date(tokenExp * 1000),
          },
        });
      }

      // 2. Nullify optional FK references so the final Lecturer delete is not
      //    blocked by a RESTRICT constraint from these nullable columns.
      // RoomReservation.reservedBy is a plain string (no FK), no nullify needed.
      await tx.bookingHold.updateMany({
        where: { lecturerId },
        data: { lecturerId: null },
      });

      // 3. Delete Timetable entries (non-nullable FK, no cascade defined on schema).
      await tx.timetable.deleteMany({ where: { lecturerId } });

      // 4. Delete OnlineAttendanceSessions; OnlineAttendanceRecord cascades via schema.
      await tx.onlineAttendanceSession.deleteMany({ where: { lecturerId } });

      // 5. Delete ConductedSession records (plain string field, no Prisma FK relation).
      await tx.conductedSession.deleteMany({ where: { lecturerId } });

      // 6. Delete Materials; MaterialView cascades via Material (onDelete: Cascade).
      await tx.material.deleteMany({ where: { lecturerId } });

      // 7. Delete Assignments; Submission cascades via Assignment (onDelete: Cascade).
      await tx.assignment.deleteMany({ where: { lecturerId } });

      // 8. Delete MeetingInvites (plain string field, no Prisma FK relation).
      await tx.meetingInvite.deleteMany({ where: { lecturerId } });

      // 9. Delete LecturerNotifications (plain string field, no Prisma FK relation).
      await tx.lecturerNotification.deleteMany({ where: { lecturerId } });

      // 10. Delete LecturerReports (plain string field, no Prisma FK relation).
      await tx.lecturerReport.deleteMany({ where: { lecturerId } });

      // 11. MergedSession removed from schema — no-op.

      // 12. Hard-delete the Lecturer row.
      //     Schema cascades fire here: LecturerAuth, ExtraSession.
      await tx.lecturer.delete({ where: { id: lecturerId } });
    });

    // Audit log (outside the transaction — non-critical, do not roll back for this)
    console.info(
      JSON.stringify({
        event: "lecturer.account.deleted",
        lecturerId,
        institutionId: lecturer.institutionId,
        ip,
        timestamp: new Date().toISOString(),
      }),
    );

    return NextResponse.json({ message: "Account deleted" }, { headers: corsHeaders });
  } catch (err: any) {
    console.error("[DELETE /api/auth/lecturer/account] Error:", err);
    return new NextResponse("Internal server error", {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  }
}
