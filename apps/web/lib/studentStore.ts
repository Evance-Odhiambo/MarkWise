export const STUDENTS_STORAGE_KEY = "markwise_department_students";

export type StudentRecord = {
  id: string;
  name: string;
  admissionNumber: string;
  courseId?: string;
  email?: string;
};

export function getStudents(): StudentRecord[] {
  if (typeof window === "undefined") return [];
  const cached = window.localStorage.getItem(STUDENTS_STORAGE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      return [];
    }
  }
  return [];
}

export function setStudents(students: StudentRecord[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STUDENTS_STORAGE_KEY, JSON.stringify(students));
}