import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAdminAuthToken } from "@/lib/adminAuthJwt";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// GET /api/admin/campuses/[id] - Get single campus
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get("adminToken")?.value ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    let institutionId: string;
    try {
      const decoded = verifyAdminAuthToken(token);
      if (!decoded) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
      }
      institutionId = decoded.institutionId ?? "";
    } catch {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    const { id } = await params;

    const campus = await prisma.campus.findFirst({
      where: {
        id,
        institutionId,
      },
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
    });

    if (!campus) {
      return NextResponse.json({ message: "Campus not found" }, { status: 404, headers: corsHeaders });
    }

    return NextResponse.json({ campus }, { headers: corsHeaders });
  } catch (error) {
    console.error("[GET /api/admin/campuses/[id]] error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}

// PUT /api/admin/campuses/[id] - Update campus
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get("adminToken")?.value ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    let institutionId: string;
    let role: string;
    try {
      const decoded = verifyAdminAuthToken(token);
      if (!decoded) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
      }
      institutionId = decoded.institutionId ?? "";
      role = decoded.role ?? "";
    } catch {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // Only system_admin and super_admin can update campuses
    if (role !== "system_admin" && role !== "super_admin") {
      return NextResponse.json({ message: "Forbidden: Only system administrators can update campuses" }, { status: 403, headers: corsHeaders });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { name, code } = body;

    // Verify campus belongs to admin's institution
    const existing = await prisma.campus.findFirst({
      where: {
        id,
        institutionId,
      },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ message: "Campus not found" }, { status: 404, headers: corsHeaders });
    }

    // Check for duplicate name (excluding current campus)
    if (name && typeof name === "string" && name.trim().length > 0) {
      const duplicate = await prisma.campus.findFirst({
        where: {
          institutionId,
          name: name.trim(),
          NOT: { id },
        },
        select: { id: true },
      });

      if (duplicate) {
        return NextResponse.json({ message: "A campus with this name already exists" }, { status: 409, headers: corsHeaders });
      }
    }

    // Update campus
    const updateData: { name?: string; code?: string | null } = {};
    if (name && typeof name === "string" && name.trim().length > 0) {
      updateData.name = name.trim();
    }
    if (code !== undefined) {
      updateData.code = code && typeof code === "string" ? code.trim() : null;
    }

    const campus = await prisma.campus.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        code: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ campus }, { headers: corsHeaders });
  } catch (error) {
    console.error("[PUT /api/admin/campuses/[id]] error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}

// DELETE /api/admin/campuses/[id] - Delete campus
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get("adminToken")?.value ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!token) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    let institutionId: string;
    let role: string;
    try {
      const decoded = verifyAdminAuthToken(token);
      if (!decoded) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
      }
      institutionId = decoded.institutionId ?? "";
      role = decoded.role ?? "";
    } catch {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }

    // Only system_admin and super_admin can delete campuses
    if (role !== "system_admin" && role !== "super_admin") {
      return NextResponse.json({ message: "Forbidden: Only system administrators can delete campuses" }, { status: 403, headers: corsHeaders });
    }

    const { id } = await params;

    // Verify campus belongs to admin's institution
    const existing = await prisma.campus.findFirst({
      where: {
        id,
        institutionId,
      },
      select: {
        id: true,
        _count: {
          select: {
            buildings: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ message: "Campus not found" }, { status: 404, headers: corsHeaders });
    }

    // Check if campus has buildings
    if (existing._count.buildings > 0) {
      return NextResponse.json(
        { message: "Cannot delete campus with existing buildings. Delete all buildings first." },
        { status: 409, headers: corsHeaders }
      );
    }

    // Delete the campus
    await prisma.campus.delete({
      where: { id },
    });

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("[DELETE /api/admin/campuses/[id]] error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500, headers: corsHeaders });
  }
}
