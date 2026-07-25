import { NextResponse } from 'next/server';

/**
 * Health check endpoint for Docker and monitoring
 * GET /api/health
 */
export async function GET() {
  try {
    // Basic health check
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
    };

    // Optional: Add database check
    // Uncomment if you want to verify database connectivity
    // try {
    //   await prisma.$queryRaw`SELECT 1`;
    //   health.database = 'connected';
    // } catch (error) {
    //   health.database = 'disconnected';
    //   health.status = 'degraded';
    // }

    return NextResponse.json(health, { 
      status: 200,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
      },
      { status: 503 }
    );
  }
}
