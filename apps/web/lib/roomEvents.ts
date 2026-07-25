import { randomUUID } from "node:crypto";

export type RoomStatusType = "free" | "reserved" | "occupied" | "unavailable";

export type RoomStatusEvent = {
  eventId: string;
  type: "room.status.changed";
  roomId: string;
  fromStatus: RoomStatusType;
  toStatus: RoomStatusType;
  reason: string;
  actorId: string | null;
  createdAt: string;
};

type Listener = (event: RoomStatusEvent) => void;

const listeners = new Set<Listener>();

export function subscribeRoomEvents(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitRoomEvent(input: Omit<RoomStatusEvent, "eventId" | "type" | "createdAt">) {
  const event: RoomStatusEvent = {
    eventId: randomUUID(),
    type: "room.status.changed",
    createdAt: new Date().toISOString(),
    ...input,
  };

  for (const listener of listeners) {
    listener(event);
  }

  return event;
}
