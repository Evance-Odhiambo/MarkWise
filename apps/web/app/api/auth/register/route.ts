import { NextResponse } from "next/server";
import { registerStudentAccount, type StudentRegistrationInput } from "@/lib/studentRegistrationService";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StudentRegistrationInput;
    const result = await registerStudentAccount(body);

    if (!result.ok) {
      return NextResponse.json({ error: result.error, message: result.error }, { status: result.status, headers: corsHeaders });
    }

    return NextResponse.json(result.payload, { status: result.status, headers: corsHeaders });
  } catch (error) {
    if (error instanceof Error && error.message.includes("JWT_SECRET")) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: corsHeaders });
    }

    return NextResponse.json(
      { error: "Failed to register.", message: "Failed to register." },
      { status: 500, headers: corsHeaders },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}
