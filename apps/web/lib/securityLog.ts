type SecurityLogPayload = {
  action: string;
  userId: string;
  role: string;
  courseId: string;
  requestedCourseId?: string;
  result: "allowed" | "blocked" | "error";
  reason?: string;
};

export function logSecurityEvent(payload: SecurityLogPayload) {
  console.info(
    JSON.stringify({
      event: "security.scope_check",
      ...payload,
      timestamp: new Date().toISOString(),
    }),
  );
}
