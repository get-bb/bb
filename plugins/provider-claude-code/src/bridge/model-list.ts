import { type AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
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

export interface ClaudeCodeBridgeModelListMemoOptions {
  list?: () => ReturnType<typeof listClaudeCodeBridgeModels>;
  now?: () => number;
  ttlMs: number;
}

/**
 * Memoizes {@link listClaudeCodeBridgeModels} for one bridge process. Each
 * probe spawns a Claude CLI, and every picker open, thread open, and server
 * reconnect asks for the catalog; concurrent asks share one probe and a
 * settled catalog is reused until the window ends. Failures are never kept so
 * a transient probe error is retried on the next ask. The window stays short
 * because the server memoizes on top of this and this bridge outlives server
 * restarts: it absorbs bursts without doubling the staleness a login change
 * can see.
 */
export function createClaudeCodeBridgeModelListMemo({
  list = listClaudeCodeBridgeModels,
  now = Date.now,
  ttlMs,
}: ClaudeCodeBridgeModelListMemoOptions): () => ReturnType<
  typeof listClaudeCodeBridgeModels
> {
  type Catalog = Awaited<ReturnType<typeof listClaudeCodeBridgeModels>>;
  let settled: { catalog: Catalog; expiresAt: number } | null = null;
  let pending: Promise<Catalog> | null = null;
  return () => {
    if (settled !== null && settled.expiresAt > now()) {
      return Promise.resolve(settled.catalog);
    }
    settled = null;
    if (pending !== null) {
      return pending;
    }
    const probe = list()
      .then((catalog) => {
        settled = { catalog, expiresAt: now() + ttlMs };
        return catalog;
      })
      .finally(() => {
        if (pending === probe) {
          pending = null;
        }
      });
    pending = probe;
    return probe;
  };
}
