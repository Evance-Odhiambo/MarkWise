import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuthToken } from '@/lib/adminAuthJwt';
import { MappingService } from '@/lib/ble/MappingService';
import { BLEIdManager } from '@/lib/ble/BLEIdManager';
import { resolveUnitFields } from '@/lib/unitCode';

// GET /api/units?departmentId=xxx  OR  ?institutionId=xxx
export async function GET(req: NextRequest) {
  // No authentication required for GET

  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get('departmentId');
  const institutionId = searchParams.get('institutionId');

  if (!departmentId && !institutionId) {
    return NextResponse.json({ error: 'departmentId or institutionId is required' }, { status: 400 });
  }

  try {
    const where = departmentId
      ? { departmentId }
      : { department: { institutionId: institutionId! } };

    const units = await prisma.unit.findMany({
      where,
      orderBy: { code: 'asc' },
      include: {
        semesters: {
          include: {
            year: {
              include: { course: true },
            },
          },
        },
      },
    });
    return NextResponse.json(units);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch units' }, { status: 500 });
  }
}

// POST /api/units
export async function POST(req: NextRequest) {
  // Require authentication; derive departmentId from the admin's DB record
  const { resolveAdminScope } = await import('@/lib/adminScope');
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const data = await req.json();
  const { code: rawCode, title: rawTitle, courseId } = data;
  // Auto-detect and correct swapped code/title fields before storing.
  const { code, title } = resolveUnitFields(rawCode, rawTitle);

  // Server-side departmentId: dept admin always uses their own; institution admin may specify
  const departmentId: string = scope.isInstitutionAdmin
    ? (data.departmentId ?? '').trim()
    : (scope.departmentId ?? '');

  if (!code || !title || !departmentId || !courseId) {
    return NextResponse.json({ error: 'code, title, departmentId, and courseId are required' }, { status: 400 });
  }
  try {
    // Get institutionId from department for scoped BLE ID assignment
    const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { institutionId: true } });
    const institutionId = department?.institutionId ?? '';
    const nextBleId = await BLEIdManager.getNextUnitId(institutionId);
    const unit = await prisma.unit.create({
      data: {
        code, title, departmentId, bleId: nextBleId,
        courses: { connect: { id: courseId } },
      },
    });
    if (institutionId) {
      await BLEIdManager.autoAssignIds(institutionId);
      const mappingSet = await MappingService.generateMappingSet(institutionId);
      await MappingService.saveMappingSet(institutionId, mappingSet);
    }
    return NextResponse.json(unit, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create unit' }, { status: 500 });
  }
}
