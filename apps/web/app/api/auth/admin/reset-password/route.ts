import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/hash";

export async function POST(req: Request) {
  const { token, password } = await req.json();
  if (!token || !password) {
    return NextResponse.json({ error: "Token and password are required." }, { status: 400 });
  }

  // Find token in DB
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token }, include: { admin: true } });
  if (!resetToken || resetToken.expiresAt < new Date() || resetToken.used) {
    return NextResponse.json({ error: "Invalid or expired token." }, { status: 400 });
  }

  // Hash new password
  const hashed = await hashPassword(password);

  // Update admin password
  await prisma.admin.update({
    where: { id: resetToken.adminId },
    data: { password: hashed },
  });

  // Mark token as used
  await prisma.passwordResetToken.update({ where: { token }, data: { used: true } });

  return NextResponse.json({ success: true });
}
