import { type AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { buildClaudeCodeModels } from "../model-list.js";
import { translateMissingClaudeCliCatalogError } from "./missing-cli-error.js";
import { resolveClaudeCodeExecutable } from "./session-options.js";

function buildModelProbeOptions(env: NodeJS.ProcessEnv): Options {
  const pathToClaudeCodeExecutable = resolveClaudeCodeExecutable({ env });
  return {
    cwd: process.cwd(),
    env,
    maxTurns: 0,
    persistSession: false,
    settingSources: ["user", "project", "local"],
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
  };
}

async function probeClaudeCodeModels(env: NodeJS.ProcessEnv): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  let session: ReturnType<typeof query>;
  try {
    session = query({
      prompt: ".",
      options: buildModelProbeOptions(env),
    });
  } catch (error) {
    throw translateMissingClaudeCliCatalogError(error);
  }

  try {
    const initialization = await session.initializationResult();
    if (initialization.models.length === 0) {
      throw new Error("Claude Code reported no models.");
    }
    return buildClaudeCodeModels(initialization.models);
  } catch (error) {
    throw translateMissingClaudeCliCatalogError(error);
  } finally {
    session.close();
  }
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
