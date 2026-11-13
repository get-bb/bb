import type { ShellWindowLayout } from "@bb/mobile-bridge";
import { createContext, useContext } from "react";

export const WindowLayoutContext = createContext<ShellWindowLayout | null>(
  null,
);

export function useWindowLayout(): ShellWindowLayout | null {
  return useContext(WindowLayoutContext);
}
