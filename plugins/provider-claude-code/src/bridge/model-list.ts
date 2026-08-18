import {
  type AvailableModel,
} from "@get-bb/plugin-sdk/provider-bridge";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { buildClaudeCodeModels } from "../model-list.js";
import { translateMissingClaudeCliError } from "./missing-cli-error.js";
import { resolveClaudeCodeExecutable } from "./session-options.js";

function buildModelProbeOptions(env: NodeJS.ProcessEnv): Options {
  const pathToClaudeCodeExecutable = resolveClaudeCodeExecutable({ env });
  return {
    cwd: process.cwd(),
    maxTurns: 0,
    persistSession: false,
    allowDangerouslySkipPermissions: true,
    permissionMode: "bypassPermissions",
    settingSources: [],
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
  };
}

export async function listClaudeCodeBridgeModels(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  // Claude's initialization response is account-scoped and is the provider's
  // authoritative list of runnable models. Keep BB's curated labels and
  // reasoning policy, but only expose entries covered by a discovered value or
  // its canonical resolved model id. Probe failures intentionally propagate so
  // callers can distinguish temporary discovery failure from definite absence.
  let session: ReturnType<typeof query>;
  try {
    session = query({
      prompt: ".",
      options: buildModelProbeOptions(env),
    });
  } catch (error) {
    throw translateMissingClaudeCliError(error);
  }

  try {
    const initialization = await session.initializationResult();
    return buildClaudeCodeModels(initialization.models);
  } catch (error) {
    throw translateMissingClaudeCliError(error);
  } finally {
    session.close();
  }
}
