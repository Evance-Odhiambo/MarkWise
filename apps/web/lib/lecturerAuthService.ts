import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { signLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { normalizeEmail, normalizePhone, readLecturerAccounts } from "@/lib/lecturerStore";

export const lecturerAuthCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type SigninBody = {
  emailOrPhoneNumber?: string;
  password?: string;
};

export async function handleLecturerSignin(request: Request) {
  try {
    const body = (await request.json()) as SigninBody;
    const identifier = body.emailOrPhoneNumber?.trim() ?? "";
    const password = body.password ?? "";

    if (!identifier || !password) {
      return NextResponse.json(
        { error: "emailOrPhoneNumber and password are required." },
        { status: 400, headers: lecturerAuthCorsHeaders },
      );
    }

    const normalizedEmail = normalizeEmail(identifier);
    const normalizedPhone = normalizePhone(identifier);

    const lecturers = await readLecturerAccounts();
    const lecturer = lecturers.find(
      (item) =>
        normalizeEmail(item.email) === normalizedEmail ||
        normalizePhone(item.phoneNumber) === normalizedPhone,
    );

    if (!lecturer) {
      return NextResponse.json(
        { error: "Invalid credentials." },
        { status: 401, headers: lecturerAuthCorsHeaders },
      );
    }

    const isValidPassword = await bcrypt.compare(password, lecturer.passwordHash);
    if (!isValidPassword) {
      return NextResponse.json(
        { error: "Invalid credentials." },
        { status: 401, headers: lecturerAuthCorsHeaders },
      );
    }

    const accessToken = signLecturerAccessToken({
      lecturerId: lecturer.id,
      email: lecturer.email,
      phoneNumber: lecturer.phoneNumber,
    });

    return NextResponse.json(
      {
        lecturerId: lecturer.id, // Added at root level
        accessToken,
        lecturer: {
          id: lecturer.id,
          fullName: lecturer.fullName,
          email: lecturer.email,
          phoneNumber: lecturer.phoneNumber,
          institutionId: lecturer.institutionId,
        },
      },
      { status: 200, headers: lecturerAuthCorsHeaders },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("JWT_SECRET")) {
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: lecturerAuthCorsHeaders },
      );
    }

    return NextResponse.json(
      { error: "Failed to sign in lecturer." },
      { status: 500, headers: lecturerAuthCorsHeaders },
    );
  }
}
