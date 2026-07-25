import { NextResponse } from "next/server";
import { findCourseById } from "@/lib/courseStore";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { getStudentAuthUsers } from "@/lib/studentAuthStore";
import { readStudents } from "@/lib/studentStore.server";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const extractBearerToken = (authorizationHeader: string | null) => {
  if (!authorizationHeader) return null;
  const [type, token] = authorizationHeader.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
};

export async function GET(request: Request) {
  try {
    const token = extractBearerToken(request.headers.get("authorization"));
    if (!token) {
      return NextResponse.json(
        { error: "Missing or invalid authorization header." },
        { status: 401, headers: corsHeaders },
      );
    }

    const payload = verifyStudentAccessToken(token);
    const users = await getStudentAuthUsers();
    const user = users.find((item) => item.id === payload.userId);

    if (!user) {
      return NextResponse.json({ error: "Account not found." }, { status: 404, headers: corsHeaders });
    }

    const students = await readStudents();
    const student = students.find((item) => item.id === user.studentId);
    const resolvedCourseId = user.courseId?.trim() || student?.courseId?.trim() || "";
    const course = resolvedCourseId ? await findCourseById(resolvedCourseId) : null;

    return NextResponse.json(
      {
        student: {
          id: user.studentId,
          admissionNumber: user.admissionNumber,
          name: student?.name ?? null,
          email: student?.email ?? user.email,
          institutionId: student?.institutionId ?? null,
          // Flat fields — mirror the sign-in response so the app can hydrate course
          // linking on every launch without a separate API call.
          courseId: resolvedCourseId || null,
          programId: null,
          courseCode: course?.code ?? null,
          courseName: course?.name ?? null,
          course: course
            ? {
                id: course.id,
                code: course.code,
                name: course.name,
              }
            : null,
        },
      },
      { headers: corsHeaders },
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token." },
      { status: 401, headers: corsHeaders },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}
