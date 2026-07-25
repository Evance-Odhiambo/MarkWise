"use client";
import { createContext, useContext } from "react";

export interface FacilitiesManagerInfo {
  id: string;
  fullName: string;
  email: string;
  role: string;
  institutionId: string;
  institutionName: string;
}

export const FacilitiesManagerContext = createContext<FacilitiesManagerInfo | null>(null);

export function useFacilitiesManager(): FacilitiesManagerInfo | null {
  return useContext(FacilitiesManagerContext);
}
