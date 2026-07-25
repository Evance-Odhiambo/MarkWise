import { verify } from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export interface AdminScope {
  ok: true;
  adminId: string;
  institutionId: string | null;
  departmentId: string | null;
  role: string;
  /** true = institution-level admin (can see all depts in their institution) */
  isInstitutionAdmin: boolean;
}

export interface AdminScopeError {
  ok: false;
  status: number;
  error: string;
}

export type AdminScopeResult = AdminScope | AdminScopeError;

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured.');
  return secret;
};

/** Extract a raw token from Authorization header or admin_auth_token cookie. */
function extractToken(request: Request | NextRequest): string | null {
  const auth = request.headers.get('authorization');
  if (auth) {
    const [type, token] = auth.split(' ');
    if (type === 'Bearer' && token) return token;
  }
  // Fall back to cookie (used by browser-based admin dashboard pages)
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)admin_auth_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

/**
 * Resolves the authenticated admin's full scope by:
 *  1. Extracting + verifying the JWT (Bearer header or admin_auth_token cookie)
 *  2. Loading the Admin row from the DB to get authoritative departmentId / institutionId
 *
 * Always use this for mutating routes to prevent cross-department writes.
 */
export async function resolveAdminScope(request: Request | NextRequest): Promise<AdminScopeResult> {
  const token = extractToken(request);
  if (!token) {
    return { ok: false, status: 401, error: 'Missing authorization.' };
  }

  let adminId: string;
  let payload: any;
  try {
    payload = verify(token, getJwtSecret()) as any;
    adminId = payload.adminId || payload.id;
    if (!adminId) throw new Error('No adminId in token');
  } catch {
    return { ok: false, status: 401, error: 'Invalid or expired token.' };
  }

  // Institution-level roles can see all departments/data within their institution.
  const INSTITUTION_LEVEL_ROLES = ['system_admin', 'academic_registrar', 'facilities_manager'];

  // Fast path: new tokens embed departmentId/institutionId/role — skip DB entirely
  if (payload.departmentId !== undefined || payload.institutionId !== undefined) {
    return {
      ok: true,
      adminId,
      role: payload.role ?? 'system_admin',
      institutionId: payload.institutionId ?? null,
      departmentId: payload.departmentId ?? null,
      isInstitutionAdmin: INSTITUTION_LEVEL_ROLES.includes(payload.role ?? ''),
    };
  }

  // Slow path: old token without embedded scope — fall back to DB
  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { id: true, role: true, institutionId: true, departmentId: true },
  });
  if (!admin) {
    return { ok: false, status: 401, error: 'Admin account not found.' };
  }

  return {
    ok: true,
    adminId: admin.id,
    role: admin.role,
    institutionId: admin.institutionId,
    departmentId: admin.departmentId,
    isInstitutionAdmin: INSTITUTION_LEVEL_ROLES.includes(admin.role),
  };
}

// ── Legacy helper (kept for backward compat — reads claims from JWT only) ────
export function getAdminScopeFromJWT(req: NextRequest): AdminScopeResult {
  const token = extractToken(req);
  if (!token) return { ok: false, status: 401, error: 'Missing Authorization header' };
  try {
    const payload = verify(token, getJwtSecret()) as any;
    const INSTITUTION_LEVEL_ROLES = ['system_admin', 'academic_registrar', 'facilities_manager'];
    return {
      ok: true,
      adminId: payload.adminId || payload.id,
      institutionId: payload.institutionId ?? null,
      departmentId: payload.departmentId ?? null,
      role: payload.role || 'system_admin',
      isInstitutionAdmin: INSTITUTION_LEVEL_ROLES.includes(payload.role || ''),
    };
  } catch {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }
}
