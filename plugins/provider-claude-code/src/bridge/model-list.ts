import { type AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import { buildClaudeCodeModels } from "../model-list.js";
import { withHostManagedAccountConfig } from "./host-managed-account.js";
import { probeClaudeInitialization } from "./initialization-probe.js";

type ContributedEnv = Readonly<Record<string, string>>;

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
  envVars: ContributedEnv = {},
): ReturnType<typeof probeClaudeCodeModels> {
  return withHostManagedAccountConfig(
    { ...process.env, ...envVars },
    async (env) => {
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
    },
  );
}

interface ClaudeCodeBridgeModelListMemoOptions {
  list?: (
    envVars: ContributedEnv,
  ) => ReturnType<typeof listClaudeCodeBridgeModels>;
  now?: () => number;
  ttlMs: number;
}

function envSignature(envVars: ContributedEnv): string {
  return JSON.stringify(
    Object.entries(envVars).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function createClaudeCodeBridgeModelListMemo({
  list = listClaudeCodeBridgeModels,
  now = Date.now,
  ttlMs,
}: ClaudeCodeBridgeModelListMemoOptions): (
  envVars: ContributedEnv,
) => ReturnType<typeof listClaudeCodeBridgeModels> {
  type Catalog = Awaited<ReturnType<typeof listClaudeCodeBridgeModels>>;
  let settled: {
    signature: string;
    catalog: Catalog;
    expiresAt: number;
  } | null = null;
  let pending: { signature: string; probe: Promise<Catalog> } | null = null;
  return (envVars) => {
    const signature = envSignature(envVars);
    if (
      settled !== null &&
      settled.signature === signature &&
      settled.expiresAt > now()
    ) {
      return Promise.resolve(settled.catalog);
    }
    if (pending !== null && pending.signature === signature) {
      return pending.probe;
    }
    const probe = list(envVars).then((catalog) => {
      if (pending?.probe === probe) {
        settled = { signature, catalog, expiresAt: now() + ttlMs };
      }
      return catalog;
    });
    const current = { signature, probe };
    pending = current;
    void probe.then(
      () => {
        if (pending === current) pending = null;
      },
      () => {
        if (pending === current) pending = null;
      },
    );
    return probe;
  };
}
