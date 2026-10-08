// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getActiveThreadPanelOpener,
  resetActiveThreadPanelOpenerForTest,
} from "@/components/plugin/plugin-thread-panel-navigation";
import { usePanelPluginPanels } from "./usePanelPluginPanels";

interface SurfaceCase {
  name: string;
  slot: "threadPanelAction" | "experimental_newThreadPanelAction";
  actions: readonly { pluginId: string; id: string; title: string }[];
}

const ACTION = { pluginId: "demo", id: "board", title: "Board" };

const SURFACES: readonly SurfaceCase[] = [
  { name: "thread view", slot: "threadPanelAction", actions: [ACTION] },
  {
    name: "New thread screen",
    slot: "experimental_newThreadPanelAction",
    actions: [ACTION],
  },
];

function renderSurface(surface: SurfaceCase, isFocused = true) {
  const openPluginPanel = vi.fn();
  const reveal = vi.fn();
  const { result } = renderHook(() =>
    usePanelPluginPanels({
      actions: surface.actions,
      isFocused,
      openPluginPanel,
      reveal,
      slot: surface.slot,
    }),
  );
  return { openPluginPanel, result, reveal };
}

afterEach(() => {
  cleanup();
  resetActiveThreadPanelOpenerForTest();
  vi.restoreAllMocks();
});

describe.each(SURFACES)("panel plugin tabs on the $name", (surface) => {
  it("opens a registered action with its default title and JSON params", () => {
    const { openPluginPanel, result, reveal } = renderSurface(surface);
    let accepted = false;
    act(() => {
      accepted = result.current({
        pluginId: "demo",
        actionId: "board",
        params: { id: 7 },
      });
    });

    expect(accepted).toBe(true);
    expect(openPluginPanel).toHaveBeenCalledWith({
      pluginId: "demo",
      actionId: "board",
      title: "Board",
      paramsJson: JSON.stringify({ id: 7 }),
    });
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("declines unknown actions and non-JSON params without revealing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { openPluginPanel, result, reveal } = renderSurface(surface);

    expect(result.current({ pluginId: "demo", actionId: "missing" })).toBe(
      false,
    );
    expect(result.current({ pluginId: "other", actionId: "board" })).toBe(
      false,
    );
    expect(
      result.current({
        pluginId: "demo",
        actionId: "board",
        params: { when: new Date() } as never,
      }),
    ).toBe(false);
    expect(openPluginPanel).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });

  it("is the opener plugin commands use while the surface is focused", () => {
    renderSurface(surface, false);
    expect(getActiveThreadPanelOpener()).toBeNull();

    cleanup();
    const { openPluginPanel } = renderSurface(surface, true);
    getActiveThreadPanelOpener()?.({ pluginId: "demo", actionId: "board" });
    expect(openPluginPanel).toHaveBeenCalledTimes(1);
  });
});
