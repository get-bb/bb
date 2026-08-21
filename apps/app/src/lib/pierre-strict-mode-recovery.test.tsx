// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { PostRenderPhase } from "@pierre/diffs";
import { describe, expect, it, vi } from "vitest";
import { usePierreStrictModeRecoveryOptions } from "./pierre-strict-mode-recovery";

interface TestPierreInstance {
  rerender(): void;
}

interface TestPierreOptions {
  label: string;
  onPostRender?(
    node: HTMLElement,
    instance: TestPierreInstance,
    phase: PostRenderPhase,
  ): unknown;
}

describe("Pierre Strict Mode recovery", () => {
  it("waits for ref replay before repainting the retained instance", async () => {
    const onPostRender = vi.fn();
    const repaint = vi.fn();
    let discardedIsActive = true;
    const discardedRerender = vi.fn(() => {
      if (discardedIsActive) repaint();
    });
    const retainedRerender = vi.fn(repaint);
    const discardedInstance: TestPierreInstance = {
      rerender: discardedRerender,
    };
    const retainedInstance: TestPierreInstance = { rerender: retainedRerender };
    const options: TestPierreOptions = {
      label: "plugin-diff",
      onPostRender,
    };
    const { result, rerender } = renderHook(() =>
      usePierreStrictModeRecoveryOptions<TestPierreInstance, TestPierreOptions>(
        options,
      ),
    );
    const recoveredOptions = result.current;
    const node = document.createElement("diffs-container");

    recoveredOptions?.onPostRender?.(node, discardedInstance, "mount");
    discardedIsActive = false;
    recoveredOptions?.onPostRender?.(node, retainedInstance, "mount");

    expect(onPostRender).toHaveBeenNthCalledWith(
      1,
      node,
      discardedInstance,
      "mount",
    );
    expect(onPostRender).toHaveBeenNthCalledWith(
      2,
      node,
      retainedInstance,
      "mount",
    );
    expect(repaint).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
    });

    expect(discardedRerender).toHaveBeenCalledOnce();
    expect(retainedRerender).toHaveBeenCalledOnce();
    expect(repaint).toHaveBeenCalledOnce();

    rerender();
    expect(result.current).toBe(recoveredOptions);

    result.current?.onPostRender?.(node, retainedInstance, "update");
    result.current?.onPostRender?.(node, retainedInstance, "unmount");
    await act(async () => {
      await Promise.resolve();
    });

    expect(retainedRerender).toHaveBeenCalledOnce();
  });
});
