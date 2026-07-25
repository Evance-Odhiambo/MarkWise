import { NextResponse } from "next/server";
import { adminAuthCorsHeaders, handleAdminSignin } from "@/lib/adminAuthService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleAdminSignin(request);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: adminAuthCorsHeaders,
  });
}
