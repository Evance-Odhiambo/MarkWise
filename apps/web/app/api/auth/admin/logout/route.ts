import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  // Clear the admin_auth_token cookie
  const response = NextResponse.json({ success: true, message: "Logged out." });
  response.cookies.set("admin_auth_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
