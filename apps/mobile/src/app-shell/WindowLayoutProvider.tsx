import type { ReactNode } from "react";

export function refreshWindowSafeArea(): void {}

export function WindowLayoutProvider({ children }: { children: ReactNode }) {
  return children;
}
