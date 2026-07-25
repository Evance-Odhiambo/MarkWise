import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeUnitCode, resolveUnitFields } from "@/lib/unitCode";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const isValidUnitsMap = (value: unknown): value is Record<string, string[]> => {
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(
    (entry) => Array.isArray(entry) && entry.every((item) => typeof item === "string"),
  );
};

const readUnitsMap = async () => {
  // Build the map from UnitOffering records grouped by year+semester
  const offerings = await prisma.unitOffering.findMany({
    select: { year: true, semester: true, unitId: true },
  });
  const map: Record<string, string[]> = {};
  for (const rec of offerings) {
    const key = `${rec.year}-${rec.semester}`;
    if (!map[key]) map[key] = [];
    map[key].push(rec.unitId);
  }
  return map;
};

const writeUnitsMap = async (_map: Record<string, string[]>) => {
  // UnitsByYearSemester has been removed; writes are no longer supported via this path.
  // The curriculum is managed through the Course/YearBlock/Semester/Unit structure.
};

/** Extract the first integer from a label like "Year 2" → 2 or "Semester 1" → 1. */
const extractNumber = (label: string, fallback: number): number => {
  const m = label.match(/\d+/);
  return m ? parseInt(m[0], 10) : fallback;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const courseId = searchParams.get("courseId");
  const courseCode = searchParams.get("courseCode");

  // When the mobile app provides a course identifier, query from the live curriculum structure.
  // Course → YearBlock → Semester → Unit  (many-to-many via SemesterUnits relation)
  if (courseId || courseCode) {
    try {
      const course = await prisma.course.findFirst({
        where: courseId
          ? { id: courseId }
          : { code: { equals: courseCode!, mode: "insensitive" } },
        include: {
          years: {
            include: {
              semesters: {
                include: { units: true },
              },
            },
          },
        },
      });

      if (!course) {
        return NextResponse.json(
          { unitsByCourseYearSemester: {} },
          { headers: corsHeaders },
        );
      }

      const map: Record<string, string[]> = {};
      course.years.forEach((yearBlock, yi) => {
        const yearNum = extractNumber(yearBlock.name, yi + 1);
        yearBlock.semesters.forEach((semester, si) => {
          const semNum = extractNumber(semester.label, si + 1);
          const key = `${yearNum}-${semNum}`;
          if (!map[key]) map[key] = [];
          for (const unit of semester.units) {
            // resolveUnitFields auto-corrects swapped code/title DB rows at read time.
            const { code: unitCode, title: unitTitle } = resolveUnitFields(unit.code, unit.title);
            map[key].push(`${unitTitle} (${unitCode})`);
          }
        });
      });

      return NextResponse.json(
        { unitsByCourseYearSemester: map },
        { headers: corsHeaders },
      );
    } catch (err) {
      console.error("[units-by-year-semester GET] course query failed:", err);
      return NextResponse.json(
        { error: "Failed to fetch units" },
        { status: 500, headers: corsHeaders },
      );
    }
  }

  // Legacy path: return flat UnitsByYearSemester table (used by academic registrar curriculum page)
  const map = await readUnitsMap();
  return NextResponse.json({ unitsByYearSemester: map }, { headers: corsHeaders });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      unitsByYearSemester?: unknown;
    };

    if (!isValidUnitsMap(body.unitsByYearSemester)) {
      return NextResponse.json(
        { error: "Invalid payload. Expected unitsByYearSemester: Record<string, string[]>" },
        { status: 400, headers: corsHeaders },
      );
    }

    await writeUnitsMap(body.unitsByYearSemester);
    return NextResponse.json(
      { success: true, unitsByYearSemester: body.unitsByYearSemester },
      { headers: corsHeaders },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to update unitsByYearSemester." },
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
