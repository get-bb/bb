import type { ReactNode } from "react";

export const supportsRailExpansion = false;

export async function setRailExpanded(_expanded: boolean): Promise<void> {
  throw new Error("Native rail expansion is unavailable");
}

export function refreshWindowSafeArea(): void {}

export function WindowLayoutProvider({ children }: { children: ReactNode }) {
  return children;
}
