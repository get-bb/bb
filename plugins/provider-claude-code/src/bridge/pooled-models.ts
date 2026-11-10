import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const supportedSchema = z.object({ supported: z.boolean() });
const effortLevels = ["low", "medium", "high", "xhigh", "max"] as const;
const modelPageSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      display_name: z.string(),
      capabilities: z
        .object({
          effort: z
            .object({
              low: supportedSchema.optional(),
              medium: supportedSchema.optional(),
              high: supportedSchema.optional(),
              xhigh: supportedSchema.optional(),
              max: supportedSchema.optional(),
            })
            .optional(),
        })
        .optional(),
    }),
  ),
  has_more: z.boolean(),
  last_id: z.string().nullable(),
});

export async function supplementPooledClaudeModels(
  discovered: readonly ModelInfo[],
  env: NodeJS.ProcessEnv,
): Promise<ModelInfo[]> {
  const endpoint = env.BB_CLAUDE_MODEL_CATALOG_URL;
  const token = env.ANTHROPIC_AUTH_TOKEN;
  if (!endpoint || !token) return [...discovered];
  try {
    const models = [...discovered];
    const seen = new Set(
      models.map((model) => model.resolvedModel ?? model.value),
    );
    const cursors = new Set<string>();
    const signal = AbortSignal.timeout(5_000);
    const url = new URL(endpoint);
    url.searchParams.set("limit", "100");
    for (let page = 0; page < 10; page += 1) {
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${token}`,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "oauth-2025-04-20",
        },
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        return [...discovered];
      }
      const result = modelPageSchema.parse(await response.json());
      for (const model of result.data) {
        if (seen.has(model.id)) continue;
        seen.add(model.id);
        models.push({
          value: model.id,
          displayName: model.display_name,
          description: model.display_name,
          supportedEffortLevels: effortLevels.filter(
            (level) => model.capabilities?.effort?.[level]?.supported === true,
          ),
        });
      }
      if (!result.has_more) return models;
      if (!result.last_id || cursors.has(result.last_id))
        return [...discovered];
      cursors.add(result.last_id);
      url.searchParams.set("after_id", result.last_id);
    }
  } catch {
    return [...discovered];
  }
  return [...discovered];
}
