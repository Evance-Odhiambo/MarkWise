type TimetableUpdatedEvent = {
  courseId: string;
  version: number;
  updatedAt: string;
};

type TimetableEventListener = (event: TimetableUpdatedEvent) => void;

const courseListeners = new Map<string, Set<TimetableEventListener>>();

export function publishTimetableUpdatedEvent(event: TimetableUpdatedEvent) {
  const listeners = courseListeners.get(event.courseId);
  if (!listeners) return;

  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeCourseTimetableEvents(
  courseId: string,
  listener: TimetableEventListener,
): () => void {
  const current = courseListeners.get(courseId) ?? new Set<TimetableEventListener>();
  current.add(listener);
  courseListeners.set(courseId, current);

  return () => {
    const existing = courseListeners.get(courseId);
    if (!existing) return;
    existing.delete(listener);
    if (existing.size === 0) {
      courseListeners.delete(courseId);
    }
  };
}

export type { TimetableUpdatedEvent };
