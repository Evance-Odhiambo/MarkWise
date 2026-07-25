import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/hash";
import { normalizeEmail } from "@/lib/adminStore";
import { signAdminAuthToken } from "@/lib/adminAuthJwt";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const SETUP_SECRET = process.env.SUPER_ADMIN_SETUP_SECRET;

    if (!SETUP_SECRET) {
      return NextResponse.json(
        { error: "Super-admin setup is not enabled on this server." },
        { status: 403 },
      );
    }

    const body = await request.json() as {
      fullName?: string;
      email?: string;
      password?: string;
      setupSecret?: string;
    };

    if (!body.setupSecret || body.setupSecret !== SETUP_SECRET) {
      return NextResponse.json(
        { error: "Invalid setup secret." },
        { status: 403 },
      );
    }

    const fullName = (body.fullName ?? "").trim();
    const email = normalizeEmail(body.email ?? "");
    const password = body.password ?? "";

    if (!fullName) {
      return NextResponse.json({ error: "Full name is required." }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    const existing = await prisma.admin.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "An admin with this email already exists." }, { status: 409 });
    }

    const hashedPassword = await hashPassword(password);
    const admin = await prisma.admin.create({
      data: { fullName, email, password: hashedPassword, role: "super_admin" },
    });

    // Sign in immediately — set auth cookie
    const token = signAdminAuthToken({
      adminId: admin.id,
      departmentId: null,
      institutionId: null,
      role: "super_admin",
    });

    const response = NextResponse.json(
      {
        success: true,
        admin: { id: admin.id, fullName: admin.fullName, email: admin.email, role: admin.role },
      },
      { status: 201 },
    );

    response.cookies.set("admin_auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    console.error("Super-admin setup error:", error);
    return NextResponse.json({ error: "Failed to create super-admin account." }, { status: 500 });
  }
}
