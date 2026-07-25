/**
 * GET /api/student/timetable/events
 *
 * Server-Sent Events stream for real-time timetable status updates.
 * The student token may be passed as:
 *   - Authorization: Bearer <token>  (preferred)
 *   - ?token=<token>                 (query param, for RN EventSource polyfills)
 *
 * On connection the server subscribes this stream to every unit the student is
 * enrolled in.  When a lecturer updates a status via PATCH /timetable/entries/:id/status,
 * broadcastTimetableEvent() pushes a data line to every subscribed stream.
 *
 * A heartbeat comment is sent every 30 seconds so TCP keep-alive fires before
 * the client's 30 s poll timer would fire.
 *
 * NOTE: SSE requires a long-running Node.js process.  On Vercel serverless the
 * stream will be limited to Vercel's max duration.  Deploy on Railway/Render
 * alongside the signaling server for full SSE support.
 */
import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { subscribeToUnit, unsubscribeFromUnit } from "@/lib/timetableSseStore";

export const runtime = "nodejs";
// Disable response caching
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Token from Authorization header or ?token= query param
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token") ?? "";
  const headerToken = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const token = headerToken || queryToken;

  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  let studentId: string;
  try {
    const payload = verifyStudentAccessToken(token);
    studentId = payload.studentId;
  } catch {
    return new Response("Invalid or expired token", { status: 401 });
  }

  // Resolve enrolled unit codes (needed for subscription keys)
  const enrollments = await prisma.enrollment.findMany({
    where: { studentId },
    include: { unit: { select: { code: true } } },
  });
  const unitCodes = enrollments
    .map((e) => (e.unit as any)?.code as string | undefined)
    .filter((c): c is string => Boolean(c));

  const encoder = new TextEncoder();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let ctrl: ReadableStreamDefaultController<Uint8Array>;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;

      // Subscribe to every enrolled unit
      for (const uc of unitCodes) {
        subscribeToUnit(uc, ctrl);
      }

      // Send initial comment so the client knows we're connected
      ctrl.enqueue(encoder.encode(": connected\n\n"));

      // Heartbeat every 30 s to keep the connection alive
      heartbeatTimer = setInterval(() => {
        try {
          ctrl.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      }, 30_000);
    },
    cancel() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      for (const uc of unitCodes) {
        unsubscribeFromUnit(uc, ctrl);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
