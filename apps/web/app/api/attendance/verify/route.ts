import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return new NextResponse(
    JSON.stringify({ error: "This endpoint is deprecated and no longer available." }),
    {
      status: 410,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "86400",
      },
    }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
