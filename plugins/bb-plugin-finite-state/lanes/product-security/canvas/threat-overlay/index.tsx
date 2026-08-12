import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../../lib/context.js";

export function ProductSecurityThreatOverlay(): null {
  return null;
}

export function registerThreatOverlayBackend(
  _bb: BbPluginApi,
  _ctx: PluginContext,
): void {
  // WP-33 replaces this lane-local registration seam.
}
