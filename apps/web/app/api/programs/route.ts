import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/programs?departmentId=xxx  OR  ?institutionId=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get('departmentId');
  const institutionId = searchParams.get('institutionId');

  if (!departmentId && !institutionId) {
    return NextResponse.json({ error: 'departmentId or institutionId is required' }, { status: 400 });
  }

  try {
    const where = institutionId
      ? { department: { institutionId } }
      : { departmentId: departmentId! };

    const programs = await prisma.program.findMany({
      where,
      include: {
        years: {
          include: {
            semesters: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ programs });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch programs' }, { status: 500 });
  }
}

// POST /api/programs
export async function POST(req: NextRequest) {
  try {
    const { name, durationYears, departmentId } = await req.json();
    if (!name || !durationYears || !departmentId) {
      return NextResponse.json({ error: 'name, durationYears and departmentId are required' }, { status: 400 });
    }
    const program = await prisma.program.create({
      data: {
        name,
        durationYears: Number(durationYears),
        departmentId,
      },
    });
    return NextResponse.json({ program }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message ?? 'Failed to create program' }, { status: 500 });
  }
}
