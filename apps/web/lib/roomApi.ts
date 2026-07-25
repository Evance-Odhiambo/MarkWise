import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

export const roomCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-idempotency-key",
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(
    {
      apiVersion: "v1",
      data,
    },
    {
      status,
      headers: roomCorsHeaders,
    },
  );
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        apiVersion: "v1",
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      {
        status: error.status,
        headers: roomCorsHeaders,
      },
    );
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return NextResponse.json(
        {
          apiVersion: "v1",
          error: {
            code: "CONFLICT",
            message: "A record with the same unique value already exists.",
            details: {
              target: error.meta?.target,
            },
          },
        },
        {
          status: 409,
          headers: roomCorsHeaders,
        },
      );
    }

    if (error.code === "P2021" || error.code === "P2022") {
      return NextResponse.json(
        {
          apiVersion: "v1",
          error: {
            code: "DB_SCHEMA_MISMATCH",
            message: "Database schema is not up to date. Run Prisma migrations.",
          },
        },
        {
          status: 500,
          headers: roomCorsHeaders,
        },
      );
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return NextResponse.json(
      {
        apiVersion: "v1",
        error: {
          code: "DB_CONNECTION_ERROR",
          message: "Unable to connect to the database. Check DATABASE_URL and database availability.",
        },
      },
      {
        status: 500,
        headers: roomCorsHeaders,
      },
    );
  }

  if (process.env.NODE_ENV !== "production") {
    console.error("[room-api] Unhandled error", error);
  }

  return NextResponse.json(
    {
      apiVersion: "v1",
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected server error.",
      },
    },
    {
      status: 500,
      headers: roomCorsHeaders,
    },
  );
}

export function optionsResponse() {
  return new NextResponse(null, {
    status: 200,
    headers: roomCorsHeaders,
  });
}
