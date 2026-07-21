import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { AvailableModel } from "@bb/domain";
import { buildClaudeCodeModels } from "../model-list.js";

function buildModelProbeOptions(): Options {
  return {
    cwd: process.cwd(),
    maxTurns: 0,
    persistSession: false,
    allowDangerouslySkipPermissions: true,
    permissionMode: "bypassPermissions",
    settingSources: [],
  };
}

export async function listClaudeCodeBridgeModels(): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  // Claude's initialization response is account-scoped and is the provider's
  // authoritative list of runnable models. Keep BB's curated labels and
  // reasoning policy, but only expose entries covered by a discovered value or
  // its canonical resolved model id. Probe failures intentionally propagate so
  // callers can distinguish temporary discovery failure from definite absence.
  const session = query({
    prompt: ".",
    options: buildModelProbeOptions(),
  });

  try {
    const initialization = await session.initializationResult();
    return buildClaudeCodeModels(initialization.models);
  } finally {
    session.close();
  }
}
