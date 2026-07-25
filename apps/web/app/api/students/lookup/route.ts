import { NextResponse } from "next/server";
import { verifyStudentAccessToken } from "@/lib/studentAuthJwt";
import { getStudentAuthUsers } from "@/lib/studentAuthStore";
import { normalizeAdmission, readStudents } from "@/lib/studentStore.server";

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
  const { searchParams } = new URL(request.url);
  const admissionNumber = normalizeAdmission(searchParams.get("admissionNumber") ?? "");

  if (!admissionNumber) {
    return NextResponse.json(
      { error: "admissionNumber query parameter is required." },
      { status: 400, headers: corsHeaders },
    );
  }

  const students = await readStudents();
  const student = students.find(
    (item) => normalizeAdmission(item.admissionNumber) === admissionNumber,
  );

  const token = extractBearerToken(request.headers.get("authorization"));
  if (token) {
    try {
      const payload = verifyStudentAccessToken(token);
      const users = await getStudentAuthUsers();
      const authUser = users.find((item) => item.id === payload.userId);

      if (!authUser) {
        return NextResponse.json({ error: "Authenticated account not found." }, { status: 404, headers: corsHeaders });
      }

      const authStudent = students.find((item) => item.id === authUser.studentId);
      const authCourseId = authUser.courseId?.trim() || authStudent?.courseId?.trim() || "";

      if (!authCourseId) {
        return NextResponse.json(
          { error: "Authenticated student has no course mapping." },
          { status: 400, headers: corsHeaders },
        );
      }

      if (student && (student.courseId?.trim() || "") !== authCourseId) {
        return NextResponse.json(
          { error: "Cross-course access blocked. Course is derived from your authenticated session." },
          { status: 403, headers: corsHeaders },
        );
      }
    } catch {
      return NextResponse.json({ error: "Invalid or expired token." }, { status: 401, headers: corsHeaders });
    }
  }

  return NextResponse.json(
    {
      exists: Boolean(student),
      student: student ?? null,
    },
    { headers: corsHeaders },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}
