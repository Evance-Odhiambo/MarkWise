import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAdminScope } from "@/lib/adminScope";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Auth
  const scope = await resolveAdminScope(req);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status ?? 401 });
  }

  let body: { students?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const students = Array.isArray(body?.students) ? body.students : [];
  if (students.length === 0) {
    return NextResponse.json(
      { error: "students array is required and must not be empty" },
      { status: 400 },
    );
  }

  // Derive departmentId from scope (dept admin uses their own; institution admin provides it in the row)
  const firstRow = students[0] as Record<string, unknown>;
  const departmentId = scope.isInstitutionAdmin
    ? String(firstRow?.departmentId ?? "").trim()
    : (scope.departmentId ?? "");

  if (!departmentId) {
    return NextResponse.json({ error: "departmentId is required" }, { status: 400 });
  }

  // Validate department + get institutionId in one query
  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { institutionId: true },
  });
  if (!dept) {
    return NextResponse.json({ error: "Department not found" }, { status: 404 });
  }
  if (
    scope.isInstitutionAdmin &&
    scope.institutionId &&
    dept.institutionId !== scope.institutionId
  ) {
    return NextResponse.json(
      { error: "Department does not belong to your institution" },
      { status: 403 },
    );
  }

  const institutionId = dept.institutionId;
  let created = 0;
  let skipped = 0;

  // Collect all admission numbers and emails for bulk duplicate check
  const candidateAdmissions = new Set<string>();
  const candidateEmails = new Set<string>();
  const validRows: { name: string; admissionNumber: string; courseId: string; email: string | null; year: number }[] = [];

  for (const raw of students) {
    const s = raw as Record<string, unknown>;
    const name = String(s.name ?? "").trim();
    const admissionNumber = String(s.admissionNumber ?? "").trim();
    const courseId = String(s.courseId ?? "").trim();
    const emailRaw = String(s.email ?? "").trim();
    const email = emailRaw || null;

    if (!name || !admissionNumber || !courseId) { skipped++; continue; }

    candidateAdmissions.add(admissionNumber);
    if (email) candidateEmails.add(email);
    validRows.push({ name, admissionNumber, courseId, email, year: typeof s.year === "number" ? s.year : 1 });
  }

  // Bulk fetch existing records to avoid per-row queries
  const [existingAdmissions, existingEmails] = await Promise.all([
    candidateAdmissions.size > 0
      ? prisma.student.findMany({
          where: { admissionNumber: { in: [...candidateAdmissions] } },
          select: { admissionNumber: true },
        })
      : [],
    candidateEmails.size > 0
      ? prisma.student.findMany({
          where: { email: { in: [...candidateEmails] } },
          select: { email: true },
        })
      : [],
  ]);
  const takenAdmissions = new Set(existingAdmissions.map(s => s.admissionNumber));
  const takenEmails = new Set(existingEmails.map(s => s.email));

  const toInsert = validRows.filter(row => {
    if (takenAdmissions.has(row.admissionNumber)) { skipped++; return false; }
    if (row.email && takenEmails.has(row.email)) { skipped++; return false; }
    return true;
  });

  // Batch insert in chunks of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    try {
      const result = await prisma.student.createMany({
        data: batch.map(row => ({ ...row, departmentId, institutionId })),
        skipDuplicates: true,
      });
      created += result.count;
      skipped += batch.length - result.count;
    } catch {
      skipped += batch.length;
    }
  }

  return NextResponse.json({ created, skipped });
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

