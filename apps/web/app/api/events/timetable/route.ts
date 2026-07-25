import { subscribeCourseTimetableEvents } from "@/lib/timetableEvents";
import { resolveStudentCourseScope } from "@/lib/studentCourseScope";

export const runtime = "nodejs";

const encoder = new TextEncoder();

const toSseChunk = (payload: { event?: string; data?: unknown; retry?: number }) => {
  const lines: string[] = [];
  if (typeof payload.retry === "number") {
    lines.push(`retry: ${payload.retry}`);
  }
  if (payload.event) {
    lines.push(`event: ${payload.event}`);
  }
  if (typeof payload.data !== "undefined") {
    lines.push(`data: ${JSON.stringify(payload.data)}`);
  }
  lines.push("", "");
  return encoder.encode(lines.join("\n"));
};

export async function GET(request: Request) {
  const scope = await resolveStudentCourseScope(request, {
    action: "timetable_realtime_subscribe",
  });

  if (!scope.ok) {
    return new Response(JSON.stringify({ error: scope.error }), {
      status: scope.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        toSseChunk({
          event: "connected",
          retry: 2000,
          data: {
            courseId: scope.courseId,
            message: "Subscribed to course timetable updates.",
            reconnect: {
              strategy: "auto-retry",
              retryAfterMs: 2000,
            },
            pollingFallback: {
              endpoint: "/api/student/timetable",
              intervalMs: 30000,
              useIfNoneMatch: true,
            },
          },
        }),
      );

      const unsubscribe = subscribeCourseTimetableEvents(scope.courseId, (event) => {
        controller.enqueue(
          toSseChunk({
            event: "timetable.updated",
            data: event,
          }),
        );
      });

      const heartbeatId = setInterval(() => {
        controller.enqueue(toSseChunk({ event: "heartbeat", data: { ts: new Date().toISOString() } }));
      }, 15000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeatId);
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
