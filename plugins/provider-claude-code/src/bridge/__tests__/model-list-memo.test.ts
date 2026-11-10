import { describe, expect, it, vi } from "vitest";
import { createClaudeCodeBridgeModelListMemo } from "../model-list.js";

function catalog(model: string) {
  return {
    models: [
      {
        id: model,
        model,
        displayName: model,
        description: "",
        reasoningDiscovery: "known" as const,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: "medium" as const,
        isDefault: true,
      },
    ],
    selectedOnlyModels: [],
  };
}

describe("createClaudeCodeBridgeModelListMemo", () => {
  it("shares one probe per environment between concurrent asks and reuses it until the window ends", async () => {
    let currentTime = 0;
    const probes: Array<(value: ReturnType<typeof catalog>) => void> = [];
    const list = vi.fn(
      (_envVars: Readonly<Record<string, string>>) =>
        new Promise<ReturnType<typeof catalog>>((resolve) => {
          probes.push(resolve);
        }),
    );
    const listModels = createClaudeCodeBridgeModelListMemo({
      list,
      now: () => currentTime,
      ttlMs: 1_000,
    });
    const pooled = { ANTHROPIC_AUTH_TOKEN: "pool", ANTHROPIC_BASE_URL: "hub" };

    const first = listModels(pooled);
    const second = listModels({
      ANTHROPIC_BASE_URL: "hub",
      ANTHROPIC_AUTH_TOKEN: "pool",
    });
    const direct = listModels({});
    expect(list.mock.calls).toEqual([[pooled], [{}]]);
    probes[0]?.(catalog("fable"));
    probes[1]?.(catalog("opus"));
    await expect(first).resolves.toEqual(catalog("fable"));
    await expect(second).resolves.toEqual(catalog("fable"));
    await expect(direct).resolves.toEqual(catalog("opus"));

    currentTime = 999;
    await expect(listModels(pooled)).resolves.toEqual(catalog("fable"));
    expect(list).toHaveBeenCalledTimes(2);

    currentTime = 1_000;
    const refreshed = listModels(pooled);
    expect(list).toHaveBeenCalledTimes(3);
    probes[2]?.(catalog("sonnet"));
    await expect(refreshed).resolves.toEqual(catalog("sonnet"));
  });
});
