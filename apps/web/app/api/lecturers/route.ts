
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuthToken } from '@/lib/adminAuthJwt';

// GET /api/lecturers?departmentId=xxx or /api/lecturers?email=someone@example.com

export async function GET(req: NextRequest) {
  // No authentication required for GET
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email");
  const id = searchParams.get("id");
  const departmentId = searchParams.get("departmentId");
  const institutionId = searchParams.get("institutionId");

  // Fetch by email or id (single lecturer)
  if (email || id) {
    let lecturer: Awaited<ReturnType<typeof prisma.lecturer.create>> | null = null;
    if (email) {
      lecturer = await prisma.lecturer.findUnique({ where: { email } });
    } else if (id) {
      lecturer = await prisma.lecturer.findUnique({ where: { id } });
    }
    if (!lecturer) {
        return NextResponse.json({ error: "Lecturer not found." }, { status: 404 });
      }
      // Handle possible null for lecturer
      if (lecturer === null) {
        return NextResponse.json({ error: "Lecturer is null." }, { status: 404 });
    }
    return NextResponse.json({
      id: lecturer.id,
      email: lecturer.email,
      fullName: lecturer.fullName,
      phoneNumber: lecturer.phoneNumber,
      institutionId: lecturer.institutionId,
      createdAt: lecturer.createdAt,
    });
  }

  // Fetch all lecturers for a department (all institution lecturers if department is in institution)
  if (departmentId) {
    // Single query: fetch the department's institutionId + all its institution's lecturers
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: {
        institutionId: true,
        institution: {
          select: {
            lecturers: {
              orderBy: { fullName: 'asc' },
              select: {
                id: true,
                fullName: true,
                email: true,
                phoneNumber: true,
                institutionId: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });
    if (!department) {
      return NextResponse.json({ error: "Department not found." }, { status: 404 });
    }
    return NextResponse.json(department.institution?.lecturers ?? []);
  }

  // Optionally: Fetch all lecturers for an institution
  if (institutionId) {
    const lecturers = await prisma.lecturer.findMany({
      where: { institutionId },
      orderBy: { fullName: "asc" },
    });
    return NextResponse.json(lecturers);
  }

  return NextResponse.json({ error: "Missing departmentId, institutionId, email, or id parameter." }, { status: 400 });
}

// POST /api/lecturers
export async function POST(req: NextRequest) {
  try {
    // Verify admin authentication
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      verifyAdminAuthToken(token);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const data = await req.json();
    const { fullName, email, phoneNumber, departmentId, institutionId, password } = data;

    if (!fullName || !email || !institutionId || !password) {
      return NextResponse.json(
        { error: 'fullName, email, password, and institutionId are required' }, 
        { status: 400 }
      );
    }

    // Check for duplicate email globally
    const existingLecturer = await prisma.lecturer.findUnique({
      where: { email },
    });

    if (existingLecturer) {
      return NextResponse.json(
        { error: 'Lecturer with this email already exists' }, 
        { status: 409 }
      );
    }

    let lecturer: Awaited<ReturnType<typeof prisma.lecturer.create>> | null = null;

    // Use transaction for robustness
    await prisma.$transaction(async (tx) => {
      // Create the lecturer
      lecturer = await tx.lecturer.create({
        data: {
          fullName,
          email,
          phoneNumber,
          passwordHash: password, // In production, hash the password!
          institutionId,
        },
      });
      // Lecturers are linked at the institution level; departmentId is resolved
      // at query time via the department's institutionId. No join table needed.
    });

    if (!lecturer) {
      return NextResponse.json({ error: 'Lecturer creation failed' }, { status: 500 });
    }

    return NextResponse.json(lecturer!, { status: 201 });

  } catch (error) {
    console.error('Lecturer creation error:', error);
    
    let details = 'Unknown error';
    let statusCode = 500;
    
    if (error instanceof Error) {
      details = error.message;
      if (error.message.includes('Department not found')) {
        statusCode = 404;
      }
    }
    
    return NextResponse.json(
      { error: 'Failed to add lecturer', details }, 
      { status: statusCode }
    );
  }
}