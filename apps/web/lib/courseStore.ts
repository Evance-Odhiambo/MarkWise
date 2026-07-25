import { prisma } from "@/lib/prisma";

export type CourseRecord = {
  id: string;
  code: string;
  name: string;
};



const isCourseRecord = (value: unknown): value is CourseRecord => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.code === "string" &&
    typeof item.name === "string"
  );
};

// Fetch all courses from the database
export async function readCourses(): Promise<CourseRecord[]> {
  const courses = await prisma.course.findMany();
  return courses.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
  }));
}

// Deprecated: Use Prisma create/update/delete methods directly for persistence
export async function writeCourses(courses: CourseRecord[]): Promise<void> {
  throw new Error("writeCourses is deprecated. Use Prisma directly.");
}

export async function findCourseById(courseId: string): Promise<CourseRecord | null> {
  const normalizedCourseId = courseId.trim();
  if (!normalizedCourseId) return null;
  const course = await prisma.course.findUnique({ where: { id: normalizedCourseId } });
  if (!course) return null;
  return { id: course.id, code: course.code, name: course.name };
}
