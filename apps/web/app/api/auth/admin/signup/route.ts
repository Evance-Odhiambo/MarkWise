import { NextResponse } from "next/server";
import { adminAuthCorsHeaders, handleAdminSignup } from "@/lib/adminAuthService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      // Parse multipart form data and forward as a JSON-compatible request
      const formData = await request.formData();
      const data: Record<string, unknown> = {};

      for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
          // File uploads: store filename for now (real upload handled separately)
          data[key] = value.name;
        } else {
          data[key] = value;
        }
      }

      const jsonRequest = {
        ...request,
        json: async () => data,
      } as Request;

      return handleAdminSignup(jsonRequest);
    }

    // JSON body — forward directly
    return handleAdminSignup(request);
  } catch (error) {
    console.error("Signup route error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500, headers: adminAuthCorsHeaders },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: adminAuthCorsHeaders,
  });
}