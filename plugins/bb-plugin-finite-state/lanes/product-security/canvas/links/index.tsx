import type { EdgeTypes } from "@xyflow/react";
import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../../lib/context.js";

export const productSecurityEdgeTypes: EdgeTypes = {};

export function ProductSecurityLinksLayer(): null {
  return null;
}

export function registerCanvasLinksBackend(
  _bb: BbPluginApi,
  _ctx: PluginContext,
): void {
  // WP-34 replaces this lane-local registration seam.
}
