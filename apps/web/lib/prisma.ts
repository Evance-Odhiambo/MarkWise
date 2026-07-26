import * as dotenv from "dotenv";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));


dotenv.config({ path: path.resolve(__dirname, "..", ".env.local"), override: true });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const baseConnectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;

const connectionString = baseConnectionString?.includes("sslmode=")
  ? baseConnectionString
  : `${baseConnectionString}${baseConnectionString?.includes("?") ? "&" : "?"}sslmode=require`;

const pool = new pg.Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});

const adapter = new PrismaPg(pool, {
  disposeExternalPool: true,
});

/**
 * Standard Prisma client for PostgreSQL.
 * Connection pooling is handled by Prisma's built-in connection pool.
 * For production with connection limits, add ?connection_limit=10 to DATABASE_URL.
 */
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

globalForPrisma.prisma ??= prisma;

/**
 * Wraps a Prisma operation with automatic retry for transient connectivity errors
 * (P1001 = can't reach server, P1008 = operations timeout, P1017 = server closed connection).
 * Useful for handling temporary network issues.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 2000,
): Promise<T> {
  const RETRYABLE = new Set(["P1001", "P1008", "P1017"]);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code =
        err instanceof PrismaClientKnownRequestError ? err.code : null;
      if (code && RETRYABLE.has(code) && attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error("withRetry: exhausted retries");
}
