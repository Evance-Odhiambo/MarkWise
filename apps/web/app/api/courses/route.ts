import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminScope } from '@/lib/adminScope';
import { normalizeUnitCode } from "@/lib/unitCode";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function GET(request: NextRequest) {
  const scope = await resolveAdminScope(request);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status, headers: corsHeaders });
  }

  const { searchParams } = new URL(request.url);
  const requestedDeptId = (searchParams.get("departmentId") ?? "").trim();
  const requestedInstId = (searchParams.get("institutionId") ?? "").trim();

  // Institution-wide path: return courses across all departments
  if (scope.isInstitutionAdmin && requestedInstId && !requestedDeptId) {
    if (!scope.institutionId || scope.institutionId !== requestedInstId) {
      return NextResponse.json({ error: "Access denied." }, { status: 403, headers: corsHeaders });
    }
    const courses = await prisma.course.findMany({
      where: { department: { institutionId: requestedInstId } },
      include: {
        program: {
          include: {
            years: { include: { semesters: { include: { units: true } } } },
          },
        },
      },
    });
    const mapped = courses.map((course) => {
      const program = course.program;
      let years: any[] = [];
      let durationYears = 4;
      if (program) {
        durationYears = program.durationYears || 4;
        years = (program.years || []).map((year) => ({
          id: year.id, name: year.name,
          semesters: (year.semesters || []).map((semester) => ({
            id: semester.id, label: semester.label,
            units: (semester.units || []).map((unit) => ({ id: unit.id, title: unit.title, code: normalizeUnitCode(unit.code) })),
          })),
        }));
      }
      return { id: course.id, code: course.code, name: course.name, departmentId: course.departmentId, programId: course.programId, durationYears, years };
    });
    return NextResponse.json({ courses: mapped }, { headers: { ...corsHeaders, 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300' } });
  }

  let departmentId: string;
  if (scope.isInstitutionAdmin) {
    if (!requestedDeptId) {
      return NextResponse.json({ error: "Missing departmentId" }, { status: 400, headers: corsHeaders });
    }
    departmentId = requestedDeptId;
  } else {
    if (!scope.departmentId) {
      return NextResponse.json({ error: 'Your account is not linked to a department.' }, { status: 403, headers: corsHeaders });
    }
    departmentId = scope.departmentId;
  }
  // Fetch courses with full nested program structure (years, semesters, units)
  const courses = await prisma.course.findMany({
    where: { departmentId },
    include: {
      program: {
        include: {
          years: {
            include: {
              semesters: {
                include: {
                  units: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // Map durationYears and nested years/semesters/units to top-level for easier frontend use
  const coursesWithProgram = courses.map((course) => {
    const program = course.program;
    let years: any[] = [];
    let durationYears = 4;
    if (program) {
      durationYears = program.durationYears || 4;
      years = (program.years || []).map((year) => ({
        id: year.id,
        name: year.name,
        semesters: (year.semesters || []).map((semester) => ({
          id: semester.id,
          label: semester.label,
          units: (semester.units || []).map((unit) => ({
            id: unit.id,
            title: unit.title,
            code: normalizeUnitCode(unit.code),
          })),
        })),
      }));
    }
    return {
      id: course.id,
      code: course.code,
      name: course.name,
      departmentId: course.departmentId,
      programId: course.programId,
      durationYears,
      years,
    };
  });
  return NextResponse.json({ courses: coursesWithProgram }, {
    headers: {
      ...corsHeaders,
      'Cache-Control': 'private, max-age=30, stale-while-revalidate=300',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const scope = await resolveAdminScope(request);
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status, headers: corsHeaders });
    }

    const body = await request.json();
    const { code, name, programId } = body;

    // Derive departmentId server-side; never trust the body
    const departmentId: string = scope.isInstitutionAdmin
      ? (body.departmentId ?? '').trim()
      : (scope.departmentId ?? '');

    if (!code || !name || !departmentId || !programId) {
      return NextResponse.json(
        { error: "code, name, departmentId, and programId are required." },
        { status: 400, headers: corsHeaders }
      );
    }
    const created = await prisma.course.create({
      data: { code, name, departmentId, programId },
    });
    return NextResponse.json({ course: created }, { status: 201, headers: corsHeaders });
  } catch {
    return NextResponse.json(
      { error: "Failed to create course." },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
