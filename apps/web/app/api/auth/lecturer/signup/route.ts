import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  normalizeEmail,
  normalizePhone,
  readLecturerAccounts,
  type LecturerAccount,
  writeLecturerAccounts,
} from "@/lib/lecturerStore";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type SignupBody = {
  fullName?: string;
  email?: string;
  phoneNumber?: string;
  institutionId?: string;
  password?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SignupBody;

    const fullName = body.fullName?.trim() ?? "";
    const email = normalizeEmail(body.email ?? "");
    const phoneNumber = normalizePhone(body.phoneNumber ?? "");
    const institutionId = body.institutionId?.trim();
    const password = body.password ?? "";

    if (!fullName || !email || !phoneNumber || !password || !institutionId) {
      return NextResponse.json(
        { error: "fullName, email, phoneNumber, institutionId, and password are required." },
        { status: 400, headers: corsHeaders },
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters." },
        { status: 400, headers: corsHeaders },
      );
    }

    const existing = await readLecturerAccounts();

    const duplicateEmail = existing.some((item) => normalizeEmail(item.email) === email);
    if (duplicateEmail) {
      return NextResponse.json(
        { error: "Email is already in use." },
        { status: 409, headers: corsHeaders },
      );
    }

    const duplicatePhone = existing.some((item) => normalizePhone(item.phoneNumber) === phoneNumber);
    if (duplicatePhone) {
      return NextResponse.json(
        { error: "Phone number is already in use." },
        { status: 409, headers: corsHeaders },
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Save lecturer directly to database with institutionId
    const lecturer = await prisma.lecturer.create({
      data: {
        fullName,
        email,
        phoneNumber,
        institutionId,
        passwordHash,
      },
    });

    return NextResponse.json(
      {
        lecturerId: lecturer.id, // Added at root for compatibility
        lecturer: {
          lecturerId: lecturer.id, // Also inside lecturer object
          id: lecturer.id,
          fullName: lecturer.fullName,
          email: lecturer.email,
          phoneNumber: lecturer.phoneNumber,
          institutionId: lecturer.institutionId,
          createdAt: lecturer.createdAt,
        },
      },
      { status: 201, headers: corsHeaders },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to create lecturer account." },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}
