"use client";
import { createContext, useContext } from "react";

export interface DepartmentAdminInfo {
  id: string;
  fullName: string;
  email: string;
  role: string;
  institutionId: string;
  institutionName: string;
  departmentId: string;
  departmentName: string;
}

export const DepartmentAdminContext = createContext<DepartmentAdminInfo | null>(null);

export function useDepartmentAdmin(): DepartmentAdminInfo | null {
  return useContext(DepartmentAdminContext);
}
