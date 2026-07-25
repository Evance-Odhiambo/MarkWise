import { NextRequest, NextResponse } from "next/server";

// Set ALLOWED_ORIGIN env var in production to restrict cross-origin access.
// Defaults to "*" (open) which is safe for mobile-app-facing APIs where
// React Native clients don't send an Origin header.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function proxy(req: NextRequest) {
  // Short-circuit all preflight requests at the edge so per-route OPTIONS
  // handlers are never reached (avoids duplicate header overhead).
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  }

  // Inject CORS origin header into every API response.
  const res = NextResponse.next();
  res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
