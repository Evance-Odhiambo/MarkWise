import jwt from 'jsonwebtoken';

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured.");
  return secret;
};

export interface AdminTokenPayload {
  adminId: string;
  departmentId?: string | null;
  institutionId?: string | null;
  role?: string | null;
}

export function signAdminAuthToken(payload: AdminTokenPayload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

export function verifyAdminAuthToken(token: string): AdminTokenPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as AdminTokenPayload;
  } catch {
    return null;
  }
}
