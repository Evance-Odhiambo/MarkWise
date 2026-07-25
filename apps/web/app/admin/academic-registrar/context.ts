"use client";
import { createContext, useContext } from "react";

export interface AcademicRegistrarInfo {
  id: string;
  fullName: string;
  email: string;
  role: string;
  institutionId: string;
  institutionName: string;
}

export const AcademicRegistrarContext = createContext<AcademicRegistrarInfo | null>(null);

export function useAcademicRegistrar(): AcademicRegistrarInfo | null {
  return useContext(AcademicRegistrarContext);
}
