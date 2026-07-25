import { NextResponse } from "next/server";
import { verifyStudentByAdmission } from "@/lib/studentVerificationService";
import { normalizeAdmission } from "@/lib/studentStore.server";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ── In-memory rate limiter: 10 requests per minute per IP ─────────────────────
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

const DEFAULT_TIMEOUT_MS = 5_000;
const admissionFormatPattern = /^[A-Z0-9][A-Z0-9/\-]{1,31}$/;

class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

const getTimeoutMs = () => {
  const raw = process.env.STUDENT_VERIFY_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return parsed;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new RequestTimeoutError(`Verification timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const logVerification = (payload: {
  admissionNumber: string;
  latencyMs: number;
  status: number;
  lookupSource?: "cache" | "db";
  exists?: boolean;
  failureReason?: string;
}) => {
  console.info(
    JSON.stringify({
      event: "students.verify",
      ...payload,
      timestamp: new Date().toISOString(),
    }),
  );
};

export async function GET(request: Request) {
  const startedAt = Date.now();

  const clientIp = getClientIp(request);
  if (!checkRateLimit(clientIp)) {
    return NextResponse.json(
      { exists: false, message: "Too many requests. Please try again later." },
      { status: 429, headers: { ...corsHeaders, "Retry-After": "60" } },
    );
  }

  const { searchParams } = new URL(request.url);
  const admissionNumber = normalizeAdmission(searchParams.get("admissionNumber") ?? "");
  const institutionId = searchParams.get("institutionId") ?? "";

  if (!admissionNumber) {
    logVerification({
      admissionNumber,
      latencyMs: Date.now() - startedAt,
      status: 400,
      failureReason: "missing_admission_number",
    });
    return NextResponse.json(
      { exists: false, message: "admissionNumber query parameter is required." },
      { status: 400, headers: corsHeaders },
    );
  }
  if (!institutionId) {
    logVerification({
      admissionNumber,
      latencyMs: Date.now() - startedAt,
      status: 400,
      failureReason: "missing_institution_id",
    });
    return NextResponse.json(
      { exists: false, message: "institutionId query parameter is required." },
      { status: 400, headers: corsHeaders },
    );
  }
  if (!admissionFormatPattern.test(admissionNumber)) {
    logVerification({
      admissionNumber,
      latencyMs: Date.now() - startedAt,
      status: 400,
      failureReason: "invalid_format",
    });
    return NextResponse.json(
      { exists: false, message: "Invalid admission number format." },
      { status: 400, headers: corsHeaders },
    );
  }
  try {
    const timeoutMs = getTimeoutMs();
    const result = await withTimeout(verifyStudentByAdmission(admissionNumber, institutionId), timeoutMs);
    logVerification({
      admissionNumber,
      latencyMs: Date.now() - startedAt,
      status: 200,
      lookupSource: result.lookupSource,
      exists: result.payload.exists,
    });
    return NextResponse.json({ ...result.payload, institutionId }, { headers: corsHeaders });
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      logVerification({
        admissionNumber,
        latencyMs: Date.now() - startedAt,
        status: 504,
        failureReason: "timeout",
      });
      return NextResponse.json(
        { exists: false, message: "Verification request timed out. Please retry." },
        { status: 504, headers: corsHeaders },
      );
    }
    logVerification({
      admissionNumber,
      latencyMs: Date.now() - startedAt,
      status: 500,
      failureReason: "internal_error",
    });
    return NextResponse.json(
      { exists: false, message: "Failed to verify student. Please retry." },
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
