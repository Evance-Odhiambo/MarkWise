import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

// GET /api/super/institutions — list all institutions with aggregate counts
export async function GET() {
  try {
    const institutions = await prisma.institution.findMany({
      select: {
        id: true,
        name: true,
        logoUrl: true,
        _count: {
          select: {
            admins: true,
            lecturers: true,
            students: true,
            departments: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ institutions });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch institutions." },
      { status: 500 },
    );
  }
}

// POST /api/super/institutions — create a new institution (no admin)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = (body.name ?? "").trim();

    if (!name) {
      return NextResponse.json({ error: "Institution name is required." }, { status: 400 });
    }

    const institution = await prisma.institution.create({ data: { name } });

    return NextResponse.json({ institution }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to create institution." },
      { status: 500 },
    );
  }
}
