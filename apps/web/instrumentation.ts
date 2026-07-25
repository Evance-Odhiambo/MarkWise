/**
 * Next.js Instrumentation Hook
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Runs once when the Next.js server starts (Node.js runtime only).
 * Used here to register long-running background tasks such as cron jobs.
 */
export async function register() {
  // Only run in the Node.js server runtime, not in the edge runtime or during
  // client-side bundling.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWeeklyResetCron } = await import("./lib/timetableWeeklyReset");
    startWeeklyResetCron();
  }
}
