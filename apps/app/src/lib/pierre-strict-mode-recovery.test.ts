import type { PostRenderPhase } from "@pierre/diffs";
import { describe, expect, it, vi } from "vitest";
import { withPierreStrictModeRecovery } from "./pierre-strict-mode-recovery";

interface TestPierreInstance {
  rerender(): void;
}

interface TestPierreOptions {
  label: string;
  onPostRender?(
    node: string,
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
    const recoveredOptions = withPierreStrictModeRecovery<
      TestPierreInstance,
      string,
      TestPierreOptions
    >({ label: "plugin-diff", onPostRender });
    const node = "diffs-container";

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

    await Promise.resolve();

    expect(discardedRerender).toHaveBeenCalledOnce();
    expect(retainedRerender).toHaveBeenCalledOnce();
    expect(repaint).toHaveBeenCalledOnce();

    recoveredOptions?.onPostRender?.(node, retainedInstance, "update");
    recoveredOptions?.onPostRender?.(node, retainedInstance, "unmount");
    await Promise.resolve();

    expect(retainedRerender).toHaveBeenCalledOnce();
  });
});
