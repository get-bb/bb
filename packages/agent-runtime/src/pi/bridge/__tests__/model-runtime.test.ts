import { beforeEach, describe, expect, it, vi } from "vitest";

const { createConfiguredPiServices, firstRuntime, secondRuntime } = vi.hoisted(
  () => {
    const firstRuntime = { getModel: vi.fn() };
    const secondRuntime = { getModel: vi.fn() };
    return {
      createConfiguredPiServices: vi.fn(async ({ cwd }: { cwd: string }) => ({
        modelRuntime: cwd === "/tmp/project-one" ? firstRuntime : secondRuntime,
      })),
      firstRuntime,
      secondRuntime,
    };
  },
);

vi.mock("../configured-services.js", () => ({
  createConfiguredPiServices,
}));

import {
  getPiModelRuntime,
  resetPiModelRuntimesForTests,
} from "../model-runtime.js";

describe("Pi bridge model runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPiModelRuntimesForTests();
  });

  it("caches a configured model runtime for each requested project", async () => {
    const first = await getPiModelRuntime("/tmp/project-one");
    const firstAgain = await getPiModelRuntime("/tmp/project-one");
    const second = await getPiModelRuntime("/tmp/project-two");

    expect(first).toBe(firstRuntime);
    expect(firstAgain).toBe(firstRuntime);
    expect(second).toBe(secondRuntime);
    expect(createConfiguredPiServices).toHaveBeenCalledTimes(2);
    expect(createConfiguredPiServices).toHaveBeenNthCalledWith(1, {
      cwd: "/tmp/project-one",
    });
    expect(createConfiguredPiServices).toHaveBeenNthCalledWith(2, {
      cwd: "/tmp/project-two",
    });
  });
});
