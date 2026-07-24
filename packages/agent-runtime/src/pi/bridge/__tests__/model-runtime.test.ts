import { describe, expect, it, vi } from "vitest";

const { createModelRuntime, modelRuntime } = vi.hoisted(() => {
  const modelRuntime = { getModel: vi.fn() };
  return {
    createModelRuntime: vi.fn(async () => modelRuntime),
    modelRuntime,
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  ModelRuntime: { create: createModelRuntime },
}));

import { getPiModelRuntime } from "../model-runtime.js";

describe("Pi bridge model runtime", () => {
  it("creates one refreshable model runtime for all bridge sessions", async () => {
    const first = await getPiModelRuntime();
    const second = await getPiModelRuntime();

    expect(first).toBe(modelRuntime);
    expect(second).toBe(modelRuntime);
    expect(createModelRuntime).toHaveBeenCalledOnce();
    expect(createModelRuntime).toHaveBeenCalledWith();
  });
});
