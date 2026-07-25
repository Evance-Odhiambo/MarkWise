"use client";
import { createContext, useContext } from "react";

export interface SuperAdminInfo {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

export const SuperAdminContext = createContext<SuperAdminInfo | null>(null);

export function useSuperAdmin(): SuperAdminInfo | null {
  return useContext(SuperAdminContext);
}
