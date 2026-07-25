import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { MappingService } from '@/lib/ble/MappingService';
import { BLEIdManager } from '@/lib/ble/BLEIdManager';
import { normalizeUnitCode, resolveUnitFields } from '@/lib/unitCode';

// GET /api/curriculum?departmentId=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get('departmentId');
  if (!departmentId) {
    return NextResponse.json({ error: 'Missing departmentId' }, { status: 400 });
  }
  const programs = await prisma.program.findMany({
    where: { departmentId },
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
  });
  
  // Normalize semester labels in the response
  const normalizedPrograms = programs.map(program => ({
    ...program,
    years: program.years.map(year => ({
      ...year,
      semesters: year.semesters.map((semester, index) => ({
        ...semester,
        // Ensure labels are normalized to "First Semester" and "Second Semester"
        label: index === 0 ? 'First Semester' : index === 1 ? 'Second Semester' : semester.label,
      })),
    })),
  }));
  
  return NextResponse.json({ programs: normalizedPrograms });
}

// POST /api/curriculum (create or update curriculum for department)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { departmentId, programs } = body;
  if (!departmentId || !Array.isArray(programs)) {
    return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
  }
  
  // Validate structure and normalize labels
  for (const program of programs) {
    if (!program.id || !program.name || !Array.isArray(program.years)) {
      return NextResponse.json({ error: `Invalid program structure for program: ${program?.name || program?.id}` }, { status: 400 });
    }
    for (const year of program.years) {
      if (!year.id || !year.name || !Array.isArray(year.semesters)) {
        return NextResponse.json({ error: `Invalid year structure for year: ${year?.name || year?.id}` }, { status: 400 });
      }
      
      // Normalize semester labels
      year.semesters = year.semesters.map((semester: { id: string; label: string; units: unknown[] }, index: number) => {
        if (!semester.id || !semester.label || !Array.isArray(semester.units)) {
          throw new Error(`Invalid semester structure for semester: ${semester?.label || semester?.id}`);
        }
        
        // Normalize label based on position
        let normalizedLabel = semester.label;
        if (index === 0) {
          normalizedLabel = 'First Semester';
        } else if (index === 1) {
          normalizedLabel = 'Second Semester';
        }
        
        return {
          ...semester,
          label: normalizedLabel,
        };
      });
      
      for (const semester of year.semesters) {
        for (const unit of semester.units) {
          if (!unit.id || !unit.code || !unit.title) {
            return NextResponse.json({ error: `Invalid unit structure for unit: ${unit?.code || unit?.id}` }, { status: 400 });
          }
        }
      }
    }
  }

  // Helper to create course if not exists
  async function ensureCourse(program: any, departmentId: string) {
    // Check for existing course by code
    const courseCode = program.name.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8);
    let courseExists = await prisma.course.findFirst({
      where: { code: courseCode, departmentId },
    });
    if (!courseExists) {
      // No course with this code, create new
      await prisma.course.create({
        data: {
          name: program.name,
          code: courseCode,
          departmentId,
          programId: program.id,
        },
      });
    } else {
      // Course exists, update programId if needed
      if (courseExists.programId !== program.id) {
        await prisma.course.update({
          where: { id: courseExists.id },
          data: { programId: program.id },
        });
      }
    }
  }

  try {
    // Incremental upsert for programs
    for (const program of programs) {
      // Upsert program first
      await prisma.program.upsert({
        where: { id: program.id },
        update: {
          name: program.name,
          durationYears: program.durationYears,
          departmentId,
        },
        create: {
          id: program.id,
          name: program.name,
          durationYears: program.durationYears,
          departmentId,
        },
      });
      
      // Now ensure course exists
      await ensureCourse(program, departmentId);
      
      // Fetch the actual course for this program using code and departmentId
      const courseCode = program.name.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8);
      const course = await prisma.course.findFirst({
        where: { code: courseCode, departmentId },
      });
      if (!course) {
        throw new Error(`Course not found for program: ${program.name}`);
      }
      
      // Upsert years
      for (const year of program.years) {
        await prisma.yearBlock.upsert({
          where: { id: year.id },
          update: {
            name: year.name,
            programId: program.id,
            courseId: course.id,
          },
          create: {
            id: year.id,
            name: year.name,
            programId: program.id,
            courseId: course.id,
          },
        });
        
        // Upsert semesters (labels are already normalized)
        for (let semesterIndex = 0; semesterIndex < year.semesters.length; semesterIndex++) {
          const semester = year.semesters[semesterIndex];
          
          await prisma.semester.upsert({
            where: { id: semester.id },
            update: {
              label: semester.label, // Already normalized to "First Semester" or "Second Semester"
              yearId: year.id,
            },
            create: {
              id: semester.id,
              label: semester.label, // Already normalized to "First Semester" or "Second Semester"
              yearId: year.id,
            },
          });
          
          // Upsert units — collect the real DB IDs as we go so the semester
          // set operation below always uses the canonical DB id, not the
          // frontend-generated id (which differs for pre-existing units).
          const resolvedUnitDbIds: string[] = [];

          for (const unit of semester.units) {
            try {
              // Resolve and canonicalise code+title, auto-correcting swapped fields.
              // E.g. (code="Organic Chemistry", title="SCH 2170") → (code="SCH 2170", title="Organic Chemistry")
              const { code: unitCode, title: unitTitle } = resolveUnitFields(unit.code, unit.title);
              // Check if a unit with the same code exists
              const existingUnit = await prisma.unit.findUnique({ where: { code: unitCode } });
              if (existingUnit) {
                // Unit already exists (possibly owned by another department).
                // Only update the title — never overwrite departmentId so we don't
                // steal the unit from its original owning department.
                await prisma.unit.update({
                  where: { code: unitCode },
                  data: {
                    title: unitTitle,
                    // Connect to this dept's course without changing ownership
                    courses: { connect: [{ id: course.id }] },
                  },
                });
                // Record that this department uses the unit (many-to-many link)
                await prisma.departmentUnit.upsert({
                  where: { departmentId_unitId: { departmentId, unitId: existingUnit.id } },
                  update: {},
                  create: { departmentId, unitId: existingUnit.id },
                });
                // Use the real DB id, not the frontend-supplied unit.id
                resolvedUnitDbIds.push(existingUnit.id);
              } else {
                // Create new unit — assign BLE ID in U0–U199, scoped to this institution
                const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { institutionId: true } });
                const nextBleId = dept?.institutionId
                  ? await BLEIdManager.getNextUnitId(dept.institutionId)
                  : BLEIdManager.UNIT_RANGE.min;
                const created = await prisma.unit.create({
                  data: {
                    id: unit.id,
                    code: unitCode,
                    title: unitTitle,
                    departmentId,
                    bleId: nextBleId,
                    courses: { connect: [{ id: course.id }] },
                  },
                });
                // Populate DepartmentUnit for the owning department
                await prisma.departmentUnit.upsert({
                  where: { departmentId_unitId: { departmentId, unitId: created.id } },
                  update: {},
                  create: { departmentId, unitId: created.id },
                });
                resolvedUnitDbIds.push(created.id);
              }
            } catch (unitError) {
              console.error(`Unit upsert error for unit ${unit.id}:`, unitError);
              return NextResponse.json({ error: `Failed to upsert unit ${unit.code || unit.id}: ${unitError}` }, { status: 500 });
            }
          }

          // Connect units to semester using the real DB ids collected above.
          // Using resolvedUnitDbIds (not semester.units[].id) is critical for
          // shared units whose DB id differs from the frontend-generated id.
          try {
            await prisma.semester.update({
              where: { id: semester.id },
              data: {
                units: {
                  set: resolvedUnitDbIds.map((id) => ({ id })),
                },
              },
            });
          } catch (semError) {
            console.error(`Semester update error for semester ${semester.id}:`, semError);
            return NextResponse.json({ error: `Failed to update semester ${semester.id}: ${semError}` }, { status: 500 });
          }
        }
      }
    }

    // Delete programs for this department that are no longer in the submitted list
    const submittedProgramIds = (programs as any[]).map((p) => p.id);
    if (submittedProgramIds.length > 0) {
      await prisma.program.deleteMany({
        where: { departmentId, NOT: { id: { in: submittedProgramIds } } },
      });
    } else {
      await prisma.program.deleteMany({ where: { departmentId } });
    }

    // Get institutionId from department
    const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { institutionId: true } });
    if (department?.institutionId) {
      await BLEIdManager.autoAssignIds(department.institutionId);
      const mappingSet = await MappingService.generateMappingSet(department.institutionId);
      await MappingService.saveMappingSet(department.institutionId, mappingSet);
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Curriculum save error:", error);
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

// DELETE /api/curriculum?courseId=xxx OR /api/curriculum?programId=xxx
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const courseId = searchParams.get('courseId');
  const programId = searchParams.get('programId');

  if (!courseId && !programId) {
    return NextResponse.json({ error: 'Missing courseId or programId' }, { status: 400 });
  }

  try {
    if (courseId) {
      // Check if course exists
      const course = await prisma.course.findUnique({ where: { id: courseId } });
      if (!course) {
        return NextResponse.json({ error: 'Course not found or already deleted.' }, { status: 404 });
      }
      // Delete the entire course record (cascade will delete children)
      await prisma.course.delete({ where: { id: courseId } });
      return NextResponse.json({ ok: true });
    }

    if (programId) {
      // Check if program exists
      const program = await prisma.program.findUnique({ where: { id: programId } });
      if (!program) {
        return NextResponse.json({ error: 'Program not found or already deleted.' }, { status: 404 });
      }
      // Cascade delete handled by Prisma schema
      await prisma.program.delete({ where: { id: programId } });

      // Cleanup any orphaned courses (with null programId)
      try {
        // Use the same logic as scripts/cleanupNullProgramCourses.ts
        const deleted = await prisma.$executeRawUnsafe('DELETE FROM "Course" WHERE "programId" IS NULL');
        if (deleted > 0) {
          console.log(`Deleted ${deleted} orphaned courses with null programId after program delete.`);
        }
      } catch (cleanupError) {
        console.error('Cleanup of orphaned courses failed:', cleanupError);
        // Do not block main response on cleanup failure
      }

      return NextResponse.json({ ok: true });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}