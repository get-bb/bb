import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../../lib/context.js";

export function VerificationRunDetailLayer(): null {
  return null;
}

export function registerVerificationRunDetailBackend(
  _bb: BbPluginApi,
  _ctx: PluginContext,
): void {
  // WP-40 replaces this lane-local registration seam.
}
