import { resolveRoomScope } from "@/lib/roomAuth";
import { subscribeRoomEvents } from "@/lib/roomEvents";

export const runtime = "nodejs";

const encoder = new TextEncoder();

const toSseChunk = (event: string, data: unknown) => {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
};

export async function GET(request: Request) {
  const scope = await resolveRoomScope(request);
  if (!scope.ok) {
    return Response.json(
      {
        apiVersion: "v1",
        error: {
          code: "UNAUTHORIZED",
          message: scope.error,
        },
      },
      { status: scope.status },
    );
  }

  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        toSseChunk("ready", {
          apiVersion: "v1",
          role: scope.role,
          connectedAt: new Date().toISOString(),
        }),
      );

      const unsubscribe = subscribeRoomEvents((payload) => {
        try {
          controller.enqueue(toSseChunk("room.status.changed", { apiVersion: "v1", ...payload }));
        } catch {
          teardown();
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(toSseChunk("heartbeat", { ts: new Date().toISOString() }));
        } catch {
          teardown();
        }
      }, 20_000);

      const teardown = () => {
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener("abort", teardown);
        try { controller.close(); } catch { /* already closed */ }
      };

      cleanup = teardown;
      request.signal.addEventListener("abort", teardown);
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
