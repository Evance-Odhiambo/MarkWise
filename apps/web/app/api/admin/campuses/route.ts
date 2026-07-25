import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAdminAuthToken } from "@/lib/adminAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// GET /api/admin/campuses - List all campuses for the admin's institution
export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("adminToken")?.value ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    let adminId: string;
    let institutionId: string;
    let role: string;
    try {
      const decoded = verifyAdminAuthToken(token);
      if (!decoded) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
      }
      adminId = decoded.adminId;
      institutionId = decoded.institutionId ?? "";
      role = decoded.role ?? "";
    } catch {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // Fetch campuses for this institution
    const campuses = await prisma.campus.findMany({
      where: { institutionId },
      select: {
        id: true,
        name: true,
        code: true,
        createdAt: true,
        _count: {
          select: {
            buildings: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ campuses }, { headers: corsHeaders });
  } catch (error) {
    console.error("[GET /api/admin/campuses] error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}

// POST /api/admin/campuses - Create a new campus
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("adminToken")?.value ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    let adminId: string;
    let institutionId: string;
    let role: string;
    try {
      const decoded = verifyAdminAuthToken(token);
      if (!decoded) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
      }
      adminId = decoded.adminId;
      institutionId = decoded.institutionId ?? "";
      role = decoded.role ?? "";
    } catch {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // Only system_admin and super_admin can create campuses
    if (role !== "system_admin" && role !== "super_admin") {
      return NextResponse.json({ message: "Forbidden: Only system administrators can create campuses" }, { status: 403, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const { name, code } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ message: "Campus name is required" }, { status: 422, headers: corsHeaders });
    }

    // Check if campus with same name already exists in this institution
    const existing = await prisma.campus.findFirst({
      where: {
        institutionId,
        name: name.trim(),
      },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json({ message: "A campus with this name already exists" }, { status: 409, headers: corsHeaders });
    }

    // Create the campus
    const campus = await prisma.campus.create({
      data: {
        name: name.trim(),
        code: code && typeof code === "string" ? code.trim() : null,
        institutionId,
      },
      select: {
        id: true,
        name: true,
        code: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ campus }, { status: 201, headers: corsHeaders });
  } catch (error) {
    console.error("[POST /api/admin/campuses] error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
