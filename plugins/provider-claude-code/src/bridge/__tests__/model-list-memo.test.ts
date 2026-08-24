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

    const first = listModels();
    const second = listModels();
    expect(list).toHaveBeenCalledTimes(1);
    resolveProbe(catalog("opus"));
    await expect(first).resolves.toEqual(catalog("opus"));
    await expect(second).resolves.toEqual(catalog("opus"));

    currentTime = 999;
    await expect(listModels()).resolves.toEqual(catalog("opus"));
    expect(list).toHaveBeenCalledTimes(1);

    currentTime = 1_000;
    const refreshed = listModels();
    expect(list).toHaveBeenCalledTimes(2);
    resolveProbe(catalog("sonnet"));
    await expect(refreshed).resolves.toEqual(catalog("sonnet"));
  });

  it("does not keep a failed probe", async () => {
    const list = vi
      .fn<() => Promise<ReturnType<typeof catalog>>>()
      .mockRejectedValueOnce(new Error("temporary discovery failure"))
      .mockResolvedValueOnce(catalog("opus"));
    const listModels = createClaudeCodeBridgeModelListMemo({
      list,
      ttlMs: 60_000,
    });

    await expect(listModels()).rejects.toThrow("temporary discovery failure");
    await expect(listModels()).resolves.toEqual(catalog("opus"));
    expect(list).toHaveBeenCalledTimes(2);
  });
});
