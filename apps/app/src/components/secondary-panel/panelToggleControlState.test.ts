import { describe, expect, it, vi } from "vitest";
import { resolveConversationCollapseControl } from "./panelToggleControlState";

describe("resolveConversationCollapseControl", () => {
  it("collapses the conversation when it is shown", () => {
    const onToggleConversationCollapse = vi.fn();
    const state = resolveConversationCollapseControl({
      isConversationCollapsed: false,
      onToggleConversationCollapse,
    });

    expect(state.action).toBe("enter-full-screen");
    expect(state.label).toBe("Full Screen");
    expect(state.isFullScreen).toBe(false);
    expect(state.iconName).toBe("Maximize2");

    state.onClick();
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });

  it("restores the conversation when it is collapsed", () => {
    const onToggleConversationCollapse = vi.fn();
    const state = resolveConversationCollapseControl({
      isConversationCollapsed: true,
      onToggleConversationCollapse,
    });

    expect(state.action).toBe("exit-full-screen");
    expect(state.label).toBe("Exit Full Screen");
    expect(state.isFullScreen).toBe(true);
    expect(state.iconName).toBe("Minimize2");

    state.onClick();
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });
});
