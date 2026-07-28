/**
 * POST /api/student/register-device
 * 
 * Registers a student's device key for relay QR/PIN signature verification.
 * Called after first successful attendance mark to enable relay functionality.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyStudentToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

interface RegisterDeviceBody {
  deviceKey: string;
  studentId: string;
}

export async function POST(req: NextRequest) {
  try {
    // Verify student authentication
    const tokenPayload = await verifyStudentToken(req);
    if (!tokenPayload) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body: RegisterDeviceBody = await req.json();
    const { deviceKey, studentId } = body;

    // Validate request body
    if (!deviceKey || !studentId) {
      return NextResponse.json(
        { error: "Missing deviceKey or studentId" },
        { status: 400 }
      );
    }

    // Validate device key format (64-char hex)
    if (!/^[0-9a-f]{64}$/i.test(deviceKey)) {
      return NextResponse.json(
        { error: "Invalid deviceKey format (expected 64-char hex)" },
        { status: 400 }
      );
    }

    // Ensure authenticated student matches request
    if (tokenPayload.studentId !== studentId) {
      return NextResponse.json(
        { error: "Student ID mismatch" },
        { status: 403 }
      );
    }

    // Check if device key already registered
    const existing = await prisma.studentDevice.findFirst({
      where: {
        deviceKey,
      },
    });

    if (existing) {
      // If this device key is registered to a DIFFERENT student, reject to prevent
      // cross-account relay identity theft. The device key is meant to be wallet-bound.
      if (existing.studentId !== studentId) {
        return NextResponse.json({
          error: "This device key is already linked to another account",
        }, { status: 409 });
      }

      // Same student re-registering — update timestamp and succeed.
      await prisma.studentDevice.update({
        where: { id: existing.id },
        data: { lastUsedAt: new Date() },
      });

      return NextResponse.json({
        success: true,
        message: "Device key already registered",
        deviceId: existing.id,
      });
    }

    // Register new device
    const device = await prisma.studentDevice.create({
      data: {
        studentId,
        deviceKey,
        registeredAt: new Date(),
        lastUsedAt: new Date(),
      },
    });

    console.log(`[RegisterDevice] Student ${studentId} registered device ${device.id}`);

    return NextResponse.json({
      success: true,
      message: "Device registered successfully",
      deviceId: device.id,
    });
  } catch (error) {
    console.error("[RegisterDevice] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
