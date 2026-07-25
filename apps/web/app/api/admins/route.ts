import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/admins?institutionId=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const institutionId = searchParams.get("institutionId");

  try {
    const where = institutionId ? { institutionId } : {};
    const admins = await prisma.admin.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        createdAt: true,
        institutionId: true,
        departmentId: true,
        institution: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ admins });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch admins." }, { status: 500 });
  }
}
