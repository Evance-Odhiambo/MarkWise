import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { comparePassword } from "@/lib/hash";
import { signFacilitiesManagerToken } from "@/lib/facilitiesManagerAuthJwt";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { email, password } = body;

  if (typeof email !== "string" || !email || typeof password !== "string" || !password) {
    return NextResponse.json(
      { error: "email and password are required." },
      { status: 400 }
    );
  }

  const manager = await prisma.facilitiesManager.findUnique({ where: { email } });
  if (!manager) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const valid = await comparePassword(password, manager.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const token = signFacilitiesManagerToken({
    id: manager.id,
    email: manager.email,
    institutionId: manager.institutionId,
  });

  return NextResponse.json({
    token,
    id: manager.id,
    email: manager.email,
    institutionId: manager.institutionId,
  });
}
