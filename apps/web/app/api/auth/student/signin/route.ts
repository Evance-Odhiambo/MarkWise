import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { findCourseById } from "@/lib/courseStore";
import { signStudentAccessToken } from "@/lib/studentAuthJwt";
import { getStudentAuthUsers } from "@/lib/studentAuthStore";
import { normalizeAdmission, normalizeEmail, readStudents } from "@/lib/studentStore.server";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type SigninBody = {
  admissionNumberOrEmail?: string;
  password?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SigninBody;
    const identityRaw = body.admissionNumberOrEmail?.trim() ?? "";
    const password = body.password ?? "";

    if (!identityRaw || !password) {
      return NextResponse.json(
        { error: "admissionNumberOrEmail and password are required." },
        { status: 400, headers: corsHeaders },
      );
    }

    const users = await getStudentAuthUsers();
    const identityEmail = normalizeEmail(identityRaw);
    const identityAdmission = normalizeAdmission(identityRaw);

    const user = users.find(
      (item) =>
        normalizeEmail(item.email) === identityEmail ||
        normalizeAdmission(item.admissionNumber) === identityAdmission,
    );

    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials." },
        { status: 401, headers: corsHeaders },
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: "Invalid credentials." },
        { status: 401, headers: corsHeaders },
      );
    }

    const students = await readStudents();
    const student = students.find((item) => item.id === user.studentId);
    const resolvedCourseId = user.courseId?.trim() || student?.courseId?.trim() || "";
    const course = resolvedCourseId ? await findCourseById(resolvedCourseId) : null;

    const token = signStudentAccessToken({
      userId: user.id,
      studentId: user.studentId,
      courseId: resolvedCourseId || undefined,
      admissionNumber: user.admissionNumber,
      email: user.email,
    });

    return NextResponse.json(
      {
        accessToken: token,
        student: {
          id: user.studentId,
          admissionNumber: user.admissionNumber,
          name: student?.name ?? null,
          email: student?.email ?? user.email,
          institutionId: student?.institutionId ?? null,
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
  } catch (error) {
    if (error instanceof Error && error.message.includes("JWT_SECRET")) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
    }

    return NextResponse.json(
      { error: "Failed to sign in." },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}
