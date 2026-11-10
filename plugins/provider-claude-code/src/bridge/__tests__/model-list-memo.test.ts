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
  it("shares one probe between concurrent asks and reuses it until the window ends", async () => {
    let currentTime = 0;
    let resolveProbe: (value: ReturnType<typeof catalog>) => void = () => {};
    const list = vi.fn(
      () =>
        new Promise<ReturnType<typeof catalog>>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const listModels = createClaudeCodeBridgeModelListMemo({
      list,
      now: () => currentTime,
      ttlMs: 1_000,
    });

    const first = listModels({});
    const second = listModels({});
    expect(list).toHaveBeenCalledTimes(1);
    resolveProbe(catalog("opus"));
    await expect(first).resolves.toEqual(catalog("opus"));
    await expect(second).resolves.toEqual(catalog("opus"));

    currentTime = 999;
    await expect(listModels({})).resolves.toEqual(catalog("opus"));
    expect(list).toHaveBeenCalledTimes(1);

    currentTime = 1_000;
    const refreshed = listModels({});
    expect(list).toHaveBeenCalledTimes(2);
    resolveProbe(catalog("sonnet"));
    await expect(refreshed).resolves.toEqual(catalog("sonnet"));
  });

  it("probes again with the new environment when the Account Pooler's routing changes", async () => {
    const pooled = {
      ANTHROPIC_BASE_URL: "http://127.0.0.1:4000/pool",
      ANTHROPIC_AUTH_TOKEN: "hub-token",
    };
    const list = vi.fn(async (envVars: Readonly<Record<string, string>>) => {
      if (envVars.ANTHROPIC_AUTH_TOKEN === undefined) {
        throw new Error("Not logged in");
      }
      return catalog(envVars.ANTHROPIC_AUTH_TOKEN);
    });
    const listModels = createClaudeCodeBridgeModelListMemo({
      list,
      now: () => 0,
      ttlMs: 1_000,
    });

    await expect(listModels({})).rejects.toThrow("Not logged in");
    await expect(listModels(pooled)).resolves.toEqual(catalog("hub-token"));
    await expect(
      listModels({
        ANTHROPIC_AUTH_TOKEN: "hub-token",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:4000/pool",
      }),
    ).resolves.toEqual(catalog("hub-token"));
    expect(list.mock.calls.map(([envVars]) => envVars)).toEqual([{}, pooled]);

    await expect(
      listModels({ ...pooled, ANTHROPIC_AUTH_TOKEN: "rotated" }),
    ).resolves.toEqual(catalog("rotated"));
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("does not let a superseded environment's answer replace the current one", async () => {
    const resolvers = new Map<
      string,
      (value: ReturnType<typeof catalog>) => void
    >();
    const list = vi.fn(
      (envVars: Readonly<Record<string, string>>) =>
        new Promise<ReturnType<typeof catalog>>((resolve) => {
          resolvers.set(envVars.ANTHROPIC_AUTH_TOKEN ?? "cli", resolve);
        }),
    );
    const listModels = createClaudeCodeBridgeModelListMemo({
      list,
      now: () => 0,
      ttlMs: 1_000,
    });

    const cli = listModels({});
    const pooled = listModels({ ANTHROPIC_AUTH_TOKEN: "hub" });
    resolvers.get("hub")?.(catalog("pooled"));
    resolvers.get("cli")?.(catalog("cli"));
    await expect(cli).resolves.toEqual(catalog("cli"));
    await expect(pooled).resolves.toEqual(catalog("pooled"));

    await expect(listModels({ ANTHROPIC_AUTH_TOKEN: "hub" })).resolves.toEqual(
      catalog("pooled"),
    );
    expect(list).toHaveBeenCalledTimes(2);
  });
});
