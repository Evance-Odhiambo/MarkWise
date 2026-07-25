import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// GET /api/institution/[institutionId]/campuses - List all campuses for an institution
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ institutionId: string }> }
) {
  try {
    const { institutionId } = await params;

    if (!institutionId) {
      return NextResponse.json(
        { message: "Institution ID is required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Verify institution exists
    const institution = await prisma.institution.findUnique({
      where: { id: institutionId },
      select: { id: true },
    });

    if (!institution) {
      return NextResponse.json(
        { message: "Institution not found" },
        { status: 404, headers: corsHeaders }
      );
    }

    // Fetch campuses for this institution
    const campuses = await prisma.campus.findMany({
      where: { institutionId },
      select: {
        id: true,
        name: true,
        code: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ campuses }, { headers: corsHeaders });
  } catch (error) {
    console.error("[GET /api/institution/[institutionId]/campuses] error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
