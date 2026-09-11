// @vitest-environment jsdom
import { defaultResolvedCodeTheme } from "@bb/domain";
import { resolveTheme } from "@pierre/diffs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyResolvedCodeTheme } from "./code-theme";

const worker = vi.hoisted(() => ({
  getOrCreate: vi.fn(),
  terminate: vi.fn(),
}));

vi.mock("@pierre/diffs/worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pierre/diffs/worker")>();
  return {
    ...actual,
    getOrCreateWorkerPoolSingleton: worker.getOrCreate,
    terminateWorkerPoolSingleton: worker.terminate,
  };
});

const { acquirePierreWorkerPool } = await import("./pierre-worker-pool");

afterEach(() => {
  applyResolvedCodeTheme(defaultResolvedCodeTheme);
  worker.getOrCreate.mockReset();
  worker.terminate.mockReset();
});

describe("acquirePierreWorkerPool", () => {
  it("registers the selected plugin theme before constructing the pool", async () => {
    const sourceName = "bb:plugin:worker-pool-test:dark";
    applyResolvedCodeTheme({
      dark: sourceName,
      light: defaultResolvedCodeTheme.light,
      files: {
        [sourceName]: {
          type: "dark",
          colors: {
            "editor.background": "#101010",
            "editor.foreground": "#f0f0f0",
          },
          tokenColors: [],
        },
      },
    });
    const theme = {
      dark: document.documentElement.dataset.bbCodeThemeDark!,
      light: defaultResolvedCodeTheme.light,
    };
    let resolution: Promise<unknown> | undefined;
    const pool = {};
    worker.getOrCreate.mockImplementation(({ highlighterOptions }) => {
      resolution = resolveTheme(highlighterOptions.theme.dark);
      return pool;
    });

    expect(acquirePierreWorkerPool(theme)).toBe(pool);
    await expect(resolution).resolves.toMatchObject({ name: theme.dark });
  });
});
