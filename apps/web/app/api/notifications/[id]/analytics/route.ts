/**
 * PATCH /api/notifications/:id/analytics
 *
 * Increments read or clicked counter on a LecturerNotification.
 * Called by the mobile app when a student opens or clicks a notification.
 *
 * Body: { "event": "read" | "clicked", "studentId": string }
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: { event?: string; studentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400, headers: corsHeaders });
  }

  const { event } = body;
  if (event !== "read" && event !== "clicked") {
    return NextResponse.json(
      { message: "event must be 'read' or 'clicked'" },
      { status: 400, headers: corsHeaders },
    );
  }

  try {
    const updateData =
      event === "read"
        ? { readCount: { increment: 1 } }
        : { clickedCount: { increment: 1 } };

    await prisma.lecturerNotification.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") {
      return NextResponse.json({ message: "Notification not found" }, { status: 404, headers: corsHeaders });
    }
    console.error("[notifications/:id/analytics] error:", err);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
