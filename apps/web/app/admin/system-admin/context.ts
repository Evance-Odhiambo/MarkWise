"use client";
import { createContext, useContext } from "react";

export interface SystemAdminInfo {
  id: string;
  fullName: string;
  email: string;
  role: string;
  institutionId: string;
  institutionName: string;
}

export const SystemAdminContext = createContext<SystemAdminInfo | null>(null);

export function useSystemAdmin(): SystemAdminInfo | null {
  return useContext(SystemAdminContext);
}
