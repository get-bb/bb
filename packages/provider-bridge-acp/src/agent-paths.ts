import path from "node:path";

export type AgentPathFlavor = typeof path.posix;

export function isWin32ShapedPath(value: string): boolean {
  return (
    (path.win32.isAbsolute(value) && !path.posix.isAbsolute(value)) ||
    value.includes("\\")
  );
}

export function agentPathFlavorForAnchor(anchor: string): AgentPathFlavor {
  return isWin32ShapedPath(anchor) ? path.win32 : path.posix;
}
