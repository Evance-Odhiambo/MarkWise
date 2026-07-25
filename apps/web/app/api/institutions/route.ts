import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonOk, jsonError, optionsResponse } from "@/lib/roomApi";

// GET /api/institutions
export async function GET(req: NextRequest) {
  try {
    const institutions = await prisma.institution.findMany();
    const minimalInstitutions = institutions.map(({ id, name }) => ({ id, name }));
    return jsonOk(minimalInstitutions);
  } catch (error) {
    return jsonError(error);
  }
}

export function OPTIONS() {
  return optionsResponse();
}
