import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { type AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { buildClaudeCodeModels } from "../model-list.js";
import { probeClaudeInitialization } from "./initialization-probe.js";

const CLAUDE_MODELS_URL_ENV = "BB_CLAUDE_MODELS_URL";
const CLAUDE_MODELS_TIMEOUT_MS = 10_000;
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
const supportedSchema = z.object({ supported: z.boolean() }).optional();
const claudeModelPageSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      display_name: z.string(),
      capabilities: z
        .object({
          effort: z
            .object({
              low: supportedSchema,
              medium: supportedSchema,
              high: supportedSchema,
              xhigh: supportedSchema,
              max: supportedSchema,
            })
            .nullish(),
        })
        .nullish(),
    }),
  ),
  has_more: z.boolean(),
  last_id: z.string().nullable(),
});

export async function listAccountModels(
  env: NodeJS.ProcessEnv,
): Promise<ModelInfo[] | null> {
  const endpoint = env[CLAUDE_MODELS_URL_ENV];
  const token = env.ANTHROPIC_AUTH_TOKEN;
  if (!endpoint || !token) {
    return null;
  }
  const models: ModelInfo[] = [];
  const signal = AbortSignal.timeout(CLAUDE_MODELS_TIMEOUT_MS);
  const url = new URL(endpoint);
  url.searchParams.set("limit", "1000");
  while (true) {
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
      },
      signal,
    });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Listing Claude models from ${url.origin}${url.pathname} failed with HTTP ${response.status}.`,
      );
    }
    const page = claudeModelPageSchema.parse(await response.json());
    for (const model of page.data) {
      models.push({
        value: model.id,
        displayName: model.display_name,
        description: model.display_name,
        supportedEffortLevels: EFFORT_LEVELS.filter(
          (level) => model.capabilities?.effort?.[level]?.supported === true,
        ),
      });
    }
    if (
      !page.has_more ||
      page.last_id === null ||
      page.last_id === url.searchParams.get("after_id")
    ) {
      if (models.length === 0) {
        throw new Error(
          `Listing Claude models from ${url.origin}${url.pathname} returned no models.`,
        );
      }
      return models;
    }
    url.searchParams.set("after_id", page.last_id);
  }
}

export function preferAccountModels(
  cliModels: readonly ModelInfo[],
  accountModels: readonly ModelInfo[],
): ModelInfo[] {
  const available = new Set(accountModels.map((model) => model.value));
  const defaultModel = cliModels.find(
    (model) => model.value === "default",
  )?.resolvedModel;
  const descriptions = new Map(
    cliModels
      .filter((model) => model.value !== "default")
      .map((model) => [model.resolvedModel ?? model.value, model.description]),
  );
  const rows = accountModels.map((model) => ({
    ...model,
    description: descriptions.get(model.value) ?? model.description,
  }));
  return [
    ...rows.filter((model) => model.value === defaultModel),
    ...rows.filter((model) => model.value !== defaultModel),
    ...cliModels.filter((model) =>
      available.has(model.resolvedModel ?? model.value),
    ),
  ];
}

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
  const accountModels = await listAccountModels(env);
  return buildClaudeCodeModels(
    accountModels === null
      ? initialization.models
      : preferAccountModels(initialization.models, accountModels),
  );
}

export async function listClaudeCodeBridgeModels(
  env: NodeJS.ProcessEnv,
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

type ClaudeCodeModelCatalog = Awaited<
  ReturnType<typeof listClaudeCodeBridgeModels>
>;

interface ClaudeCodeBridgeModelListMemoOptions {
  list: (
    envVars: Readonly<Record<string, string>>,
  ) => Promise<ClaudeCodeModelCatalog>;
  now?: () => number;
  ttlMs: number;
}

export function createClaudeCodeBridgeModelListMemo({
  list,
  now = Date.now,
  ttlMs,
}: ClaudeCodeBridgeModelListMemoOptions): (
  envVars: Readonly<Record<string, string>>,
) => Promise<ClaudeCodeModelCatalog> {
  const entries = new Map<
    string,
    {
      settled: { catalog: ClaudeCodeModelCatalog; expiresAt: number } | null;
      pending: Promise<ClaudeCodeModelCatalog> | null;
    }
  >();
  return (envVars) => {
    const currentTime = now();
    for (const [key, entry] of entries) {
      if (
        entry.pending === null &&
        (entry.settled === null || entry.settled.expiresAt <= currentTime)
      ) {
        entries.delete(key);
      }
    }
    const key = JSON.stringify(
      Object.entries(envVars).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
    const entry = entries.get(key) ?? { settled: null, pending: null };
    entries.set(key, entry);
    if (entry.settled !== null) {
      return Promise.resolve(entry.settled.catalog);
    }
    if (entry.pending !== null) {
      return entry.pending;
    }
    const probe = list(envVars)
      .then((catalog) => {
        entry.settled = { catalog, expiresAt: now() + ttlMs };
        return catalog;
      })
      .finally(() => {
        if (entry.pending === probe) {
          entry.pending = null;
        }
      });
    entry.pending = probe;
    return probe;
  };
}
