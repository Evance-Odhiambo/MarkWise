import { verifyLecturerAccessToken } from "@/lib/lecturerAuthJwt";
import { verifyFacilitiesManagerJwt } from "@/lib/facilitiesManagerAuthJwt";
import { verifyAdminAuthToken } from "@/lib/adminAuthJwt";

export type RoomScope =
  | { ok: true; role: "admin" | "lecturer" | "facilitiesManager"; userId: string }
  | { ok: false; status: number; error: string };

const extractBearerToken = (authorizationHeader: string | null) => {
  if (!authorizationHeader) return null;
  const [type, token] = authorizationHeader.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
};

export async function resolveRoomScope(request: Request): Promise<RoomScope> {
  // Try admin cookie first (facilities manager uses cookie-based auth)
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)admin_auth_token=([^;]+)/);
  if (cookieMatch?.[1]) {
    const cookiePayload = verifyAdminAuthToken(decodeURIComponent(cookieMatch[1]));
    if (cookiePayload?.adminId) {
      return { ok: true, role: "admin", userId: cookiePayload.adminId };
    }
  }

  const token = extractBearerToken(request.headers.get("authorization"));
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Missing authorization. Provide admin cookie or bearer token.",
    };
  }

  // Try admin bearer token
  try {
    const payload = verifyAdminAuthToken(token);
    if (payload && payload.adminId) {
      return { ok: true, role: "admin", userId: payload.adminId };
    }
  } catch {}

  // Try lecturer token
  try {
    const payload = verifyLecturerAccessToken(token);
    return {
      ok: true,
      role: "lecturer",
      userId: payload.lecturerId,
    };
  } catch {}

  // Try room manager token
  try {
    const payload = verifyFacilitiesManagerJwt(token);
    if (payload && payload.id) {
      return {
        ok: true,
        role: "facilitiesManager",
        userId: payload.id,
      };
    }
  } catch {}

  return {
    ok: false,
    status: 401,
    error: "Invalid or expired admin, lecturer, or facilities manager token.",
  };
}
