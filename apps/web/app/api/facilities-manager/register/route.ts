import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/hash";
import { signFacilitiesManagerToken } from "@/lib/facilitiesManagerAuthJwt";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { institutionId?: unknown; email?: unknown; password?: unknown; fullName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { institutionId, email, password, fullName } = body;

  if (
    typeof institutionId !== "string" || !institutionId ||
    typeof email !== "string" || !email ||
    typeof password !== "string" || !password ||
    typeof fullName !== "string" || !fullName
  ) {
    return NextResponse.json(
      { error: "institutionId, email, password, and fullName are required." },
      { status: 400 }
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution) {
    return NextResponse.json({ error: "Institution not found." }, { status: 404 });
  }

  const existing = await prisma.facilitiesManager.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 }
    );
  }

  // Each institution can have at most one room manager
  const existingForInstitution = await prisma.facilitiesManager.findUnique({
    where: { institutionId },
  });
  if (existingForInstitution) {
    return NextResponse.json(
      { error: "A facilities manager account already exists for this institution." },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  const manager = await prisma.facilitiesManager.create({
    data: { email, passwordHash, fullName, institutionId },
  });

  const token = signFacilitiesManagerToken({
    id: manager.id,
    email: manager.email,
    institutionId: manager.institutionId,
  });

  return NextResponse.json(
    { token, id: manager.id, email: manager.email, institutionId: manager.institutionId },
    { status: 201 }
  );
}
