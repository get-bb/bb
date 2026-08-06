import { describe, expect, it, vi } from "vitest";

const { createAgentSessionServices, modelRuntime } = vi.hoisted(() => {
  const modelRuntime = { getModel: vi.fn() };
  return {
    createAgentSessionServices: vi.fn(async () => ({
      diagnostics: [],
      modelRuntime,
    })),
    modelRuntime,
  };
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSessionServices,
  getAgentDir: vi.fn(() => "/tmp/pi-agent"),
}));

import { getPiModelRuntime } from "../model-runtime.js";

describe("Pi bridge model runtime", () => {
  it("creates one configured model runtime for the model picker", async () => {
    const first = await getPiModelRuntime();
    const second = await getPiModelRuntime();

    expect(first).toBe(modelRuntime);
    expect(second).toBe(modelRuntime);
    expect(createAgentSessionServices).toHaveBeenCalledOnce();
    expect(createAgentSessionServices).toHaveBeenCalledWith({
      agentDir: "/tmp/pi-agent",
      cwd: process.cwd(),
    });
  });
});
