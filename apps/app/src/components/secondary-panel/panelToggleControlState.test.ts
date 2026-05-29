import { describe, expect, it, vi } from "vitest";
import {
  resolveConversationCollapseControl,
  resolveShowPanelControl,
} from "./panelToggleControlState";

describe("resolveShowPanelControl", () => {
  it("opens the panel and reads as a closed disclosure", () => {
    const onToggleSecondaryPanel = vi.fn();
    const state = resolveShowPanelControl({ onToggleSecondaryPanel });

    expect(state.action).toBe("show-panel");
    expect(state.label).toBe("Show panel");
    expect(state.isExpanded).toBe(false);
    // The recognizable panel icon reads as "open the right side panel".
    expect(state.iconName).toBe("PanelRight");

    state.onClick();
    expect(onToggleSecondaryPanel).toHaveBeenCalledTimes(1);
  });
});

describe("resolveConversationCollapseControl", () => {
  it("collapses the conversation when it is shown", () => {
    const onToggleConversationCollapse = vi.fn();
    const state = resolveConversationCollapseControl({
      isConversationCollapsed: false,
      onToggleConversationCollapse,
    });

    expect(state.action).toBe("expand-panel");
    expect(state.label).toBe("Expand panel");
    // The conversation is currently expanded; clicking collapses it.
    expect(state.isExpanded).toBe(true);
    // An expand-to-fill glyph, not a directional chevron.
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

    expect(state.action).toBe("restore-conversation");
    expect(state.label).toBe("Restore conversation");
    expect(state.isExpanded).toBe(false);
    // The inverse minimize glyph restores the conversation.
    expect(state.iconName).toBe("Minimize2");

    state.onClick();
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });
});
