/**
 * In-memory pub/sub for timetable SSE streams.
 * Works with the Next.js Node.js runtime (next start / Railway / Render).
 * Not compatible with Vercel serverless — per-invocation isolation means
 * the in-memory map is not shared. Use polling + ETag as the fallback there.
 */

type SseController = ReadableStreamDefaultController<Uint8Array>;

// Map from UPPERCASE unit code → set of active SSE controllers
const unitSubscribers = new Map<string, Set<SseController>>();

// Send a keepalive comment every 20 seconds to detect dead connections
// and prevent proxies/load-balancers from closing idle SSE streams.
const keepaliveEncoder = new TextEncoder();
const keepaliveBytes = keepaliveEncoder.encode(": keepalive\n\n");
setInterval(() => {
  for (const [, subs] of unitSubscribers) {
    for (const ctrl of [...subs]) {
      try {
        ctrl.enqueue(keepaliveBytes);
      } catch {
        subs.delete(ctrl);
      }
    }
  }
}, 20_000).unref();

export function subscribeToUnit(unitCode: string, ctrl: SseController) {
  const key = unitCode.trim().toUpperCase();
  if (!unitSubscribers.has(key)) unitSubscribers.set(key, new Set());
  unitSubscribers.get(key)!.add(ctrl);
}

export function unsubscribeFromUnit(unitCode: string, ctrl: SseController) {
  const key = unitCode.trim().toUpperCase();
  unitSubscribers.get(key)?.delete(ctrl);
}

export function broadcastTimetableEvent(
  unitCode: string,
  payload: Record<string, unknown>,
) {
  const key = unitCode.trim().toUpperCase();
  const subs = unitSubscribers.get(key);
  if (!subs || subs.size === 0) return;
  const encoder = new TextEncoder();
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  const bytes = encoder.encode(line);
  for (const ctrl of [...subs]) {
    try {
      ctrl.enqueue(bytes);
    } catch {
      subs.delete(ctrl);
    }
  }
}

/** Broadcast a payload to every currently-connected student stream, regardless of unit. */
export function broadcastToAllSubscribed(payload: Record<string, unknown>) {
  const encoder = new TextEncoder();
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  const bytes = encoder.encode(line);
  for (const subs of unitSubscribers.values()) {
    for (const ctrl of [...subs]) {
      try {
        ctrl.enqueue(bytes);
      } catch {
        subs.delete(ctrl);
      }
    }
  }
}
