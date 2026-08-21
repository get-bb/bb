import type { BbRuntimeMode } from "@bb/config/runtime";

export function resolveNodeEnvironment(
  mode: BbRuntimeMode,
): "development" | "production" {
  return mode === "dev" ? "development" : "production";
}
