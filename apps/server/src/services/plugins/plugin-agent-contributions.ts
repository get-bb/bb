import type { ToolCallResponse } from "@bb/domain";
import type {
  PluginAgentToolContext,
  PluginAgentToolRecord,
} from "./plugin-api.js";
import type {
  PluginAgentToolContribution,
  PluginMentionResolveResult,
  PluginService,
} from "./plugin-service.js";

/**
 * Module-level bridge from thread runtime-config assembly to the plugin
 * service (design §4.4), mirroring plugin-thread-events.ts: the runtime
 * config helpers receive narrow `{ db, hub, config, logger }` deps assembled
 * long before the plugin service exists, so createApp registers the live
 * service here instead of threading it through every deps object. Unset
 * (tests that never build an app) both calls are cheap no-ops.
 */
type PluginAgentContributions = Pick<
  PluginService,
  | "listSkillsRootPaths"
  | "listAgentTools"
  | "findAgentTool"
  | "invokeAgentTool"
  | "resolveMention"
>;

let contributions: PluginAgentContributions | undefined;

export function setPluginAgentContributions(
  next: PluginAgentContributions | undefined,
): void {
  contributions = next;
}

/** Skills roots contributed by running plugins (the "plugin" skill tier). */
export function getPluginSkillsRootPaths(): string[] {
  return contributions?.listSkillsRootPaths() ?? [];
}

/** Native tools from bb.agents.registerTool, resolved live per session start. */
export function listPluginAgentTools(): PluginAgentToolContribution[] {
  return contributions?.listAgentTools() ?? [];
}

/** Resolve a native plugin tool by name for tool-call dispatch. */
export function findPluginAgentTool(
  name: string,
): { pluginId: string; record: PluginAgentToolRecord } | undefined {
  return contributions?.findAgentTool(name);
}

/**
 * Resolve one plugin mention at send time (design §4.9). Fails closed: with
 * no live plugin service (tests that never build an app) a plugin mention
 * cannot be resolved, and the send path blocks rather than silently
 * dropping the context the user asked for.
 */
export async function resolvePluginMention(args: {
  pluginId: string;
  itemId: string;
}): Promise<PluginMentionResolveResult> {
  const active = contributions;
  if (!active) {
    return {
      ok: false,
      error: "plugin mention resolution is unavailable on this server",
    };
  }
  return active.resolveMention(args);
}

/** Run a native plugin tool call (failure-isolated by the plugin service). */
export async function invokePluginAgentTool(
  tool: { pluginId: string; record: PluginAgentToolRecord },
  args: { input: unknown; ctx: PluginAgentToolContext },
): Promise<ToolCallResponse> {
  const active = contributions;
  if (!active) {
    return {
      success: false,
      contentItems: [
        { type: "inputText", text: `Unsupported tool: ${tool.record.name}` },
      ],
    };
  }
  return active.invokeAgentTool({
    pluginId: tool.pluginId,
    record: tool.record,
    input: args.input,
    ctx: args.ctx,
  });
}
