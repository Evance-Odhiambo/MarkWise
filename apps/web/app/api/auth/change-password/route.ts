import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyAdminAuthToken } from '@/lib/adminAuthJwt';
import { comparePassword, hashPassword } from '@/lib/hash';

export const runtime = 'nodejs';

// POST /api/auth/change-password
export async function POST(req: NextRequest) {
  // Authenticate via cookie or Bearer header
  let token: string | undefined;
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.replace('Bearer ', '').trim();
  } else {
    token = req.cookies.get('admin_auth_token')?.value;
  }
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  const payload = verifyAdminAuthToken(token);
  if (!payload || !payload.adminId) {
    return NextResponse.json({ error: 'Invalid or expired token.' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { currentPassword?: string; newPassword?: string };
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'currentPassword and newPassword are required.' }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 });
  }

  const admin = await prisma.admin.findUnique({
    where: { id: payload.adminId },
    select: { id: true, password: true },
  });
  if (!admin) {
    return NextResponse.json({ error: 'Admin account not found.' }, { status: 404 });
  }

  const valid = await comparePassword(currentPassword, admin.password);
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
  }

  const hashed = await hashPassword(newPassword);
  await prisma.admin.update({ where: { id: admin.id }, data: { password: hashed } });

  return NextResponse.json({ message: 'Password changed successfully.' });
}
