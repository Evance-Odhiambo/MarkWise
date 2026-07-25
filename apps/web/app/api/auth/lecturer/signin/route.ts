import { NextResponse } from "next/server";
import { handleLecturerSignin, lecturerAuthCorsHeaders } from "@/lib/lecturerAuthService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleLecturerSignin(request);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: lecturerAuthCorsHeaders,
  });
}
