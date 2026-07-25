import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { getStudentAuthUsers } from "@/lib/studentAuthStore";
import { logSecurityEvent } from "@/lib/securityLog";
import { readStudents } from "@/lib/studentStore.server";

const extractBearerToken = (authorizationHeader: string | null) => {
  if (!authorizationHeader) return null;
  const [type, token] = authorizationHeader.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
};

export async function resolveStudentCourseScope(
  request: Request,
  options: { action: string; requestedCourseId?: string },
): Promise<
  | {
      ok: true;
      userId: string;
      studentId: string;
      role: "student";
      courseId: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    }
> {
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return { ok: false, status: 401, error: "Missing or invalid authorization header." };
  }

  let payload: ReturnType<typeof verifyStudentAccessToken>;
  try {
    payload = verifyStudentAccessToken(token);
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired token." };
  }

  const users = await getStudentAuthUsers();
  const user = users.find((item) => item.id === payload.userId);
  if (!user) {
    return { ok: false, status: 404, error: "Authenticated account not found." };
  }

  const students = await readStudents();
  const student = students.find((item) => item.id === user.studentId);
  const courseId = user.courseId?.trim() || student?.courseId?.trim() || "";

  if (!courseId) {
    logSecurityEvent({
      action: options.action,
      userId: user.id,
      role: "student",
      courseId,
      requestedCourseId: options.requestedCourseId,
      result: "error",
      reason: "missing_course_scope",
    });

    return { ok: false, status: 400, error: "Authenticated student has no course scope." };
  }

  if (options.requestedCourseId && options.requestedCourseId !== courseId) {
    logSecurityEvent({
      action: options.action,
      userId: user.id,
      role: "student",
      courseId,
      requestedCourseId: options.requestedCourseId,
      result: "blocked",
      reason: "cross_course_requested",
    });

    return {
      ok: false,
      status: 403,
      error: "Cross-course access blocked. Course is derived from your authenticated session.",
    };
  }

  logSecurityEvent({
    action: options.action,
    userId: user.id,
    role: "student",
    courseId,
    requestedCourseId: options.requestedCourseId,
    result: "allowed",
  });

  return {
    ok: true,
    userId: user.id,
    studentId: user.studentId,
    role: "student",
    courseId,
  };
}
