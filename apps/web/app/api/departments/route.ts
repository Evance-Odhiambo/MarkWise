import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError, optionsResponse } from "@/lib/roomApi";

import { removeDuplicateDepartments } from "@/lib/removeDuplicateDepartments";


// GET /api/departments?departmentId=xxx  or  /api/departments?institutionId=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get('departmentId');
  const institutionId = searchParams.get('institutionId');
  try {
    // Single-department lookup — no auth needed (used during registration flows)
    if (departmentId) {
      const department = await prisma.department.findUnique({ where: { id: departmentId } });
      if (!department) return jsonError('Department not found');
      return jsonOk(department);
    }

    // List departments — must be scoped to an institution
    if (institutionId) {
      const departments = await prisma.department.findMany({
        where: { institutionId },
        orderBy: { name: 'asc' },
      });
      return jsonOk(departments);
    }

    // No filter supplied — require auth and scope to the admin's institution
    const { resolveAdminScope } = await import('@/lib/adminScope');
    const scope = await resolveAdminScope(req);
    if (!scope.ok) {
      return jsonError('institutionId is required or provide an admin token.');
    }
    if (!scope.institutionId) {
      return jsonError('Your account is not linked to an institution.');
    }
    const departments = await prisma.department.findMany({
      where: { institutionId: scope.institutionId },
      orderBy: { name: 'asc' },
    });
    return jsonOk(departments);
  } catch (error) {
    return jsonError(error);
  }
}

export function OPTIONS() {
  return optionsResponse();
}


// POST /api/departments
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, institutionId } = body;
    if (!name || !institutionId) {
      return jsonError("'name' and 'institutionId' are required");
    }

    // Normalize name
    const normalizedName = name.trim();

    // Create department (ignore unique error, will deduplicate below)
    let department;
    try {
      department = await prisma.department.create({
        data: { name: normalizedName, institutionId },
      });
    } catch (error: any) {
      // If unique constraint error, fetch existing
      if (error.code === 'P2002') {
        department = await prisma.department.findFirst({
          where: { name: { equals: normalizedName, mode: 'insensitive' }, institutionId },
        });
      } else {
        return jsonError(error);
      }
    }

    // Run deduplication after creation
    await removeDuplicateDepartments(prisma, institutionId, normalizedName);

    // Return the (possibly deduplicated) department
    const finalDepartment = await prisma.department.findFirst({
      where: { name: { equals: normalizedName, mode: 'insensitive' }, institutionId },
    });
    return jsonOk(finalDepartment);
  } catch (error) {
    return jsonError(error);
  }
}
