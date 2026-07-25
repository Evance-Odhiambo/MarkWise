import { NextResponse } from "next/server";
import { normalizeAdmission } from "@/lib/studentStore.server";
import { prisma } from "@/lib/prisma";
import { resolveAdminScope } from "@/lib/adminScope";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const scope = await resolveAdminScope(request);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status, headers: corsHeaders });
  }

  try {
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const name = (body.name as string | undefined)?.trim() ?? "";
    const admissionNumber = normalizeAdmission((body.admissionNumber as string | undefined) ?? "");
    const courseId = (body.courseId as string | undefined)?.trim() ?? "";
    const year = typeof body.year === "number" ? body.year : undefined;

    if (!name || !admissionNumber || !courseId) {
      return NextResponse.json(
        { error: "Name, admissionNumber and courseId are required." },
        { status: 400, headers: corsHeaders },
      );
    }

    // Verify the student belongs to the admin's department / institution
    const existing = await prisma.student.findUnique({ where: { id }, select: { departmentId: true, institutionId: true } });
    if (!existing) {
      return NextResponse.json({ error: "Student not found." }, { status: 404, headers: corsHeaders });
    }

    if (!scope.isInstitutionAdmin && scope.departmentId !== existing.departmentId) {
      return NextResponse.json({ error: "Access denied." }, { status: 403, headers: corsHeaders });
    }
    if (scope.institutionId && scope.institutionId !== existing.institutionId) {
      return NextResponse.json({ error: "Access denied." }, { status: 403, headers: corsHeaders });
    }

    // Check admission number uniqueness within institution (excluding this student)
    const duplicate = await prisma.student.findFirst({
      where: { admissionNumber, institutionId: existing.institutionId, NOT: { id } },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "Student with this admission number already exists." },
        { status: 409, headers: corsHeaders },
      );
    }

    const data: Record<string, unknown> = { name, admissionNumber, courseId };
    if (year !== undefined) data.year = year;

    const updated = await prisma.student.update({ where: { id }, data });
    return NextResponse.json({ student: updated }, { headers: corsHeaders });
  } catch {
    return NextResponse.json(
      { error: "Failed to update student." },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const scope = await resolveAdminScope(request);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status, headers: corsHeaders });
  }

  try {
    const { id } = await context.params;

    // Verify ownership before deleting
    const existing = await prisma.student.findUnique({ where: { id }, select: { departmentId: true, institutionId: true } });
    if (!existing) {
      return NextResponse.json({ error: "Student not found." }, { status: 404, headers: corsHeaders });
    }

    if (!scope.isInstitutionAdmin && scope.departmentId !== existing.departmentId) {
      return NextResponse.json({ error: "Access denied." }, { status: 403, headers: corsHeaders });
    }
    if (scope.institutionId && scope.institutionId !== existing.institutionId) {
      return NextResponse.json({ error: "Access denied." }, { status: 403, headers: corsHeaders });
    }

    await prisma.student.delete({ where: { id } });
    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete student." },
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