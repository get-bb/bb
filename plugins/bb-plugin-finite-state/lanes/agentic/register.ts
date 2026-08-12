import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";

export type AgenticRegistrar = (
  bb: BbPluginApi,
  ctx: PluginContext,
) => void;

// Composition seams for WP-58–WP-60, WP-62, and WP-64. Each owner replaces
// its no-op with a thin import; domain handlers remain in their owner modules.
export const registerReadTools: AgenticRegistrar = () => {};
export const registerWriteTools: AgenticRegistrar = () => {};
export const registerActionTools: AgenticRegistrar = () => {};
export const registerMentions: AgenticRegistrar = () => {};
export const registerFiniteStateCli: AgenticRegistrar = () => {};

const REGISTRARS = [
  registerReadTools,
  registerWriteTools,
  registerActionTools,
  registerMentions,
  registerFiniteStateCli,
] as const;

export function registerAgentic(bb: BbPluginApi, ctx: PluginContext): void {
  for (const register of REGISTRARS) register(bb, ctx);
}
