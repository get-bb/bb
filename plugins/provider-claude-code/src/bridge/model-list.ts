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

export async function addAccountModels(
  discovered: readonly ModelInfo[],
  env: NodeJS.ProcessEnv,
): Promise<ModelInfo[]> {
  const endpoint = env[CLAUDE_MODELS_URL_ENV];
  const token = env.ANTHROPIC_AUTH_TOKEN;
  if (!endpoint || !token) {
    return [...discovered];
  }
  const models = [...discovered];
  const listed = new Set(
    discovered.map((model) => model.resolvedModel ?? model.value),
  );
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
      return [...discovered];
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Listing Claude models from ${url.origin}${url.pathname} failed with HTTP ${response.status}.`,
      );
    }
    const page = claudeModelPageSchema.parse(await response.json());
    for (const model of page.data) {
      if (listed.has(model.id)) {
        continue;
      }
      listed.add(model.id);
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
      return models;
    }
    url.searchParams.set("after_id", page.last_id);
  }
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
  return buildClaudeCodeModels(
    await addAccountModels(initialization.models, env),
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
