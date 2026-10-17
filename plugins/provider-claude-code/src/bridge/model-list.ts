import { type AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import { buildClaudeCodeModels } from "../model-list.js";
import { probeClaudeInitialization } from "./initialization-probe.js";

async function probeClaudeCodeModels(env: NodeJS.ProcessEnv): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  const initialization = await probeClaudeInitialization({
    env,
    cwd: process.cwd(),
  });
  if (initialization.models.length === 0) {
    throw new Error("Claude Code reported no models.");
  }
  return buildClaudeCodeModels(initialization.models);
}

export async function listClaudeCodeBridgeModels(
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof probeClaudeCodeModels> {
  try {
    return await probeClaudeCodeModels(env);
  } catch (error) {
    if (
      env.ANTHROPIC_MODEL &&
      error instanceof Error &&
      error.message.includes("--client-data-url:") &&
      error.message.includes("pass the matching --model")
    ) {
      return probeClaudeCodeModels({ ...env, ANTHROPIC_MODEL: undefined });
    }
    throw error;
  }
}

interface ClaudeCodeBridgeModelListMemoOptions {
  list?: () => ReturnType<typeof listClaudeCodeBridgeModels>;
  now?: () => number;
  ttlMs: number;
}

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
