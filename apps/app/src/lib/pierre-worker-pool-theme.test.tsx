// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { defaultResolvedCodeTheme } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyResolvedCodeTheme } from "./code-theme";
import {
  useSyncPierreWorkerPoolTheme,
  type CodeThemePair,
} from "./pierre-worker-pool-theme";

function createFakePool() {
  const setRenderOptions = vi.fn(() => Promise.resolve());
  // Only `setRenderOptions` is exercised; the sync never touches the rest of
  // the manager.
  const pool = { setRenderOptions } as unknown as WorkerPoolManager;
  return { pool, setRenderOptions };
}

function ThemeSync({
  pool,
  constructedTheme,
}: {
  pool: WorkerPoolManager;
  constructedTheme: CodeThemePair;
}) {
  useSyncPierreWorkerPoolTheme(pool, constructedTheme);
  return null;
}

afterEach(() => {
  applyResolvedCodeTheme(defaultResolvedCodeTheme);
});

describe("useSyncPierreWorkerPoolTheme", () => {
  it("does not call setRenderOptions when the pool already has the current theme", () => {
    // `setRenderOptions` initializes the pool (spawning every worker plus a
    // main-thread highlighter) before it compares options, so a redundant
    // call on mount is what used to spawn the workers on every workspace.
    const { pool, setRenderOptions } = createFakePool();
    const constructedTheme = {
      dark: defaultResolvedCodeTheme.dark,
      light: defaultResolvedCodeTheme.light,
    };

    render(<ThemeSync pool={pool} constructedTheme={constructedTheme} />);

    expect(setRenderOptions).not.toHaveBeenCalled();
  });

  it("pushes a theme change once, then stays quiet until the next change", () => {
    const { pool, setRenderOptions } = createFakePool();
    const constructedTheme = {
      dark: defaultResolvedCodeTheme.dark,
      light: defaultResolvedCodeTheme.light,
    };
    const { rerender } = render(
      <ThemeSync pool={pool} constructedTheme={constructedTheme} />,
    );

    act(() => {
      applyResolvedCodeTheme({
        dark: "github-dark",
        light: defaultResolvedCodeTheme.light,
        files: {},
      });
    });
    expect(setRenderOptions).toHaveBeenCalledTimes(1);
    expect(setRenderOptions).toHaveBeenCalledWith({
      theme: { dark: "github-dark", light: defaultResolvedCodeTheme.light },
    });

    // An unrelated re-render must not resend the same theme.
    rerender(<ThemeSync pool={pool} constructedTheme={constructedTheme} />);
    expect(setRenderOptions).toHaveBeenCalledTimes(1);
  });

  it("applies the current theme to a pool constructed with a different one", () => {
    // A pool that outlived a theme change (Pierre keeps one page-wide
    // singleton) must be brought up to date on the next mount.
    const { pool, setRenderOptions } = createFakePool();

    render(
      <ThemeSync
        pool={pool}
        constructedTheme={{ dark: "stale-dark", light: "stale-light" }}
      />,
    );

    expect(setRenderOptions).toHaveBeenCalledTimes(1);
    expect(setRenderOptions).toHaveBeenCalledWith({
      theme: {
        dark: defaultResolvedCodeTheme.dark,
        light: defaultResolvedCodeTheme.light,
      },
    });
  });
});
