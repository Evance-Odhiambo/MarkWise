import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/sendEmail";

export async function POST(req: Request) {
  const { email } = await req.json();
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }

  // Lookup admin in database
  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) {
    // Don't reveal user existence
    return NextResponse.json({ success: true });
  }

  // Generate token and expiry (1 hour)
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60);
  await prisma.passwordResetToken.create({
    data: {
      token,
      adminId: admin.id,
      expiresAt,
    },
  });

  // Construct reset link
  const resetLink = `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/department/reset-password?token=${token}`;

  // Send email
  await sendEmail(
    email,
    "Password Reset",
    `<p>Click <a href="${resetLink}">here</a> to reset your password. This link will expire in 1 hour.</p>`
  );

  return NextResponse.json({ success: true });
}
