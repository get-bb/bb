import { type AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import { buildClaudeCodeModels } from "../model-list.js";
import { probeClaudeInitialization } from "./initialization-probe.js";
import { supplementPooledClaudeModels } from "./pooled-models.js";

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
  return buildClaudeCodeModels(
    await supplementPooledClaudeModels(initialization.models, env),
  );
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
  list?: (
    env: NodeJS.ProcessEnv,
  ) => ReturnType<typeof listClaudeCodeBridgeModels>;
  now?: () => number;
  ttlMs: number;
}

export function createClaudeCodeBridgeModelListMemo({
  list = listClaudeCodeBridgeModels,
  now = Date.now,
  ttlMs,
}: ClaudeCodeBridgeModelListMemoOptions): (
  env?: NodeJS.ProcessEnv,
) => ReturnType<typeof listClaudeCodeBridgeModels> {
  type Catalog = Awaited<ReturnType<typeof listClaudeCodeBridgeModels>>;
  let settled: { key: string; catalog: Catalog; expiresAt: number } | null =
    null;
  let pending: { key: string; probe: Promise<Catalog> } | null = null;
  return (env = process.env) => {
    const key = JSON.stringify(
      Object.entries(env).sort(([left], [right]) => left.localeCompare(right)),
    );
    if (settled !== null && settled.key === key && settled.expiresAt > now()) {
      return Promise.resolve(settled.catalog);
    }
    settled = null;
    if (pending !== null && pending.key === key) {
      return pending.probe;
    }
    const probe = list(env)
      .then((catalog) => {
        settled = { key, catalog, expiresAt: now() + ttlMs };
        return catalog;
      })
      .finally(() => {
        if (pending?.probe === probe) {
          pending = null;
        }
      });
    pending = { key, probe };
    return probe;
  };
}
