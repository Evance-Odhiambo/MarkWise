import { NextResponse } from "next/server";
import { getStudentAuthUsers } from "@/lib/studentAuthStore";

export const runtime = "nodejs";

export async function GET() {
  const users = await getStudentAuthUsers();
  return NextResponse.json({ users });
}
