// app/api/mappings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { MappingService } from "@/lib/ble/MappingService";
import { BLEIdManager } from "@/lib/ble/BLEIdManager";
import { rateLimit } from "../../../lib/rateLimit";

// Rate limiting for mapping requests
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const institutionId = searchParams.get("institutionId");
    const clientVersion = searchParams.get("version") || undefined;
    const deviceId = searchParams.get("deviceId") || "unknown";

    if (!institutionId) {
      return NextResponse.json({ error: "Missing institutionId" }, { status: 400 });
    }

    // Rate limiting
    try {
        // Use IP or institutionId as key for rate limiting
        const ip = req.headers.get('x-forwarded-for') || 'unknown';
        const { allowed, remaining } = await limiter(ip + ':' + institutionId);
        if (!allowed) {
          return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
        }
    } catch {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    // Validate institution exists
    const institution = await prisma.institution.findUnique({
      where: { id: institutionId }
    });

    if (!institution) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    // Log sync attempt
    await prisma.bLESyncLog.create({
      data: {
        institutionId,
        syncType: clientVersion ? 'incremental' : 'full',
        status: 'started',
        deviceInfo: { deviceId, userAgent: req.headers.get('user-agent') },
        startedAt: new Date()
      }
    });

    // Get mapping set with sync info
    const { mappingSet, needsFullSync } = await MappingService.syncMappingSet(
      institutionId, 
      clientVersion
    );

    // Validate and repair if needed (run occasionally)
    if (Math.random() < 0.01) { // 1% chance to run validation
      const validation = await MappingService.validateAndRepair(institutionId);
      if (validation.repaired) {
        // Regenerate mapping set after repair
        const newSet = await MappingService.generateMappingSet(institutionId);
        await MappingService.saveMappingSet(institutionId, newSet);
        return NextResponse.json({
          ...newSet,
          _meta: {
            repaired: true,
            issues: validation.issues
          }
        });
      }
    }

    // Add metadata for client
    const response = {
      ...mappingSet,
      _meta: {
        needsFullSync,
        timestamp: Date.now(),
        ttl: 3600, // Cache TTL in seconds
        unitCount: Object.keys(mappingSet.unitMappings).length,
        roomCount: Object.keys(mappingSet.roomMappings).length
      }
    };

    // Update sync log
    await prisma.bLESyncLog.updateMany({
      where: {
        institutionId,
        status: 'started',
        deviceInfo: { path: ['deviceId'], equals: deviceId }
      },
      data: {
        status: 'success',
        completedAt: new Date(),
        unitsSynced: Object.keys(mappingSet.unitMappings).length,
        roomsSynced: Object.keys(mappingSet.roomMappings).length
      }
    });

    return NextResponse.json(response);
  } catch (err: any) {
    console.error('GET mappings error:', err);
    
    // Log error
      await prisma.bLESyncLog.create({
      data: {
        institutionId: new URL(req.url).searchParams.get('institutionId') || 'unknown',
        syncType: 'error',
        status: 'failed',
        errors: { message: err.message, stack: err.stack },
        startedAt: new Date(),
        completedAt: new Date()
      }
    });

    return NextResponse.json({ 
      error: err.message || "Failed to fetch mappings",
      code: err.code 
    }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const institutionId = searchParams.get("institutionId");
    
    if (!institutionId) {
      return NextResponse.json({ error: "Missing institutionId" }, { status: 400 });
    }

    // Check authorization (you'll need to implement this)
    // await checkAdminAccess(req);

    // Auto-assign IDs if needed
    const assignment = await BLEIdManager.autoAssignIds(institutionId);
    
    // Generate new mapping set
    const mappingSet = await MappingService.generateMappingSet(institutionId);
    
    // Save to database
    await MappingService.saveMappingSet(institutionId, mappingSet);

    
    // Log the update
    await prisma.bLESyncLog.create({
      data: {
        institutionId,
        syncType: 'force',
        status: 'success',
        unitsSynced: assignment.unitsAssigned,
        roomsSynced: assignment.roomsAssigned,
        errors: assignment.errors.length > 0 ? assignment.errors : undefined,
        startedAt: new Date(),
        completedAt: new Date(),
        triggeredBy: 'admin'
      }
    });

    return NextResponse.json({ 
      success: true, 
      version: mappingSet.version,
      stats: {
        unitsAssigned: assignment.unitsAssigned,
        roomsAssigned: assignment.roomsAssigned,
        totalUnits: Object.keys(mappingSet.unitMappings).length,
        totalRooms: Object.keys(mappingSet.roomMappings).length
      }
    });
  } catch (err: any) {
    console.error('PUT mappings error:', err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Version",
      "Access-Control-Max-Age": "86400",
    },
  });
}