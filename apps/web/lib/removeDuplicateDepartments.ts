import { PrismaClient } from '@prisma/client';

/**
 * Removes duplicate departments for a given institutionId and department name (case-insensitive).
 * Keeps the oldest department and reassigns all related records to it.
 * Can be called after department creation to ensure deduplication.
 */
export async function removeDuplicateDepartments(prisma: PrismaClient, institutionId: string, name: string) {
  // Find all departments with the same name (case-insensitive) and institutionId
  const departments = await prisma.department.findMany({
    where: {
      institutionId,
      name: { equals: name, mode: 'insensitive' },
    },
    include: {
      admins: true,
      courses: true,
      students: true,
      units: true,
      programs: true,
    },
    orderBy: { id: 'asc' },
  });

  if (departments.length <= 1) return; // No duplicates

  const [keep, ...duplicates] = departments;

  for (const dup of duplicates) {
    // Update related records to point to the kept department
    await prisma.admin.updateMany({ where: { departmentId: dup.id }, data: { departmentId: keep.id } });
    await prisma.course.updateMany({ where: { departmentId: dup.id }, data: { departmentId: keep.id } });
    await prisma.student.updateMany({ where: { departmentId: dup.id }, data: { departmentId: keep.id } });
    // Timetable no longer has departmentId — department flows through UnitOffering → Course → Department
    await prisma.unit.updateMany({ where: { departmentId: dup.id }, data: { departmentId: keep.id } });
    await prisma.program.updateMany({ where: { departmentId: dup.id }, data: { departmentId: keep.id } });
    await prisma.department.delete({ where: { id: dup.id } });
  }
}
