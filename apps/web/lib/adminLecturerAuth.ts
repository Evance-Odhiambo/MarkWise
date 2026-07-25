import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { verifyAdminAuthToken } from "@/lib/adminAuthJwt";

type AdminLecturerScope =
  | {
      ok: true;
      role: "admin" | "lecturer";
      userId: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

const extractBearerToken = (authorizationHeader: string | null) => {
  if (!authorizationHeader) return null;
  const [type, token] = authorizationHeader.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
};

/** Read a cookie value from the raw Cookie header string. */
const extractCookie = (cookieHeader: string | null, name: string): string | null => {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
};

const isAuthBypassed = () => {
  const flag = process.env.BYPASS_TIMETABLE_WRITE_AUTH?.trim().toLowerCase();
  if (!flag) return false;
  return flag === "1" || flag === "true" || flag === "yes";
};

export function resolveAdminOrLecturerScope(request: Request): AdminLecturerScope {
  if (isAuthBypassed()) {
    return { ok: true, role: "admin", userId: "bypass-admin" };
  }

  // 1. Try Bearer token from Authorization header (admin or lecturer)
  const bearerToken = extractBearerToken(request.headers.get("authorization"));

  if (bearerToken) {
    const adminPayload = verifyAdminAuthToken(bearerToken);
    if (adminPayload && adminPayload.adminId) {
      return { ok: true, role: "admin", userId: adminPayload.adminId };
    }
    try {
      const payload = verifyLecturerAccessToken(bearerToken);
      return { ok: true, role: "lecturer", userId: payload.lecturerId };
    } catch {
      // fall through to cookie check
    }
  }

  // 2. Try admin_auth_token cookie (used by department dashboard pages)
  const cookieToken = extractCookie(request.headers.get("cookie"), "admin_auth_token");
  if (cookieToken) {
    const adminPayload = verifyAdminAuthToken(cookieToken);
    if (adminPayload && adminPayload.adminId) {
      return { ok: true, role: "admin", userId: adminPayload.adminId };
    }
  }

  return {
    ok: false,
    status: 401,
    error: "Missing or invalid authorization. Provide an admin or lecturer token.",
  };
}
