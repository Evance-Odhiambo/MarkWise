import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Use the Supabase pooler URL for normal app runtime.
// Only fallback to DIRECT_URL if DATABASE_URL is missing.
const baseConnectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;
const connectionString = baseConnectionString?.includes("sslmode=")
  ? baseConnectionString
  : `${baseConnectionString}${baseConnectionString?.includes("?") ? "&" : "?"}sslmode=require`;

const adapter = new PrismaPg({
  connectionString,
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

// Always cache on globalThis to prevent multiple instances
// (handles HMR in dev AND module re-evaluation edge cases in serverless)
globalForPrisma.prisma ??= prisma;

/**
 * Wraps a Prisma operation with automatic retry for transient connectivity errors
 * (P1001 = can't reach server, P1008 = operations timeout, P1017 = server closed connection).
 * Useful for handling temporary network issues.
 *
 * @example
 *   const data = await withRetry(() => prisma.user.findMany());
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
      const code = err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;
      if (code && RETRYABLE.has(code) && attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs * attempt));
        continue;
      }
      throw err;
    }
  }
  // TypeScript unreachable — retries exhausted above throws
  throw new Error("withRetry: exhausted retries");
}
