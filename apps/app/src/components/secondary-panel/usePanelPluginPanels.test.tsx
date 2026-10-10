import { renderHookStatically } from "@/test/render-hook-statically";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginThreadPanelOpenHandler } from "@/components/plugin/plugin-thread-panel-navigation";
import { usePanelPluginPanels } from "./usePanelPluginPanels";

const publishThreadPanelOpener = vi.hoisted(() =>
  vi.fn<(opener: PluginThreadPanelOpenHandler, isActive: boolean) => void>(),
);

vi.mock("@/components/plugin/plugin-thread-panel-navigation", () => ({
  usePublishThreadPanelOpener: publishThreadPanelOpener,
}));

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
  const openThreadPanel = renderHookStatically(() =>
    usePanelPluginPanels({
      actions: surface.actions,
      isFocused,
      openPluginPanel,
      reveal,
      slot: surface.slot,
    }),
  );
  return { openPluginPanel, openThreadPanel, reveal };
}

afterEach(() => {
  publishThreadPanelOpener.mockReset();
  vi.restoreAllMocks();
});

describe.each(SURFACES)("panel plugin tabs on the $name", (surface) => {
  it("opens a registered action with its default title and JSON params", () => {
    const { openPluginPanel, openThreadPanel, reveal } = renderSurface(surface);

    expect(
      openThreadPanel({
        pluginId: "demo",
        actionId: "board",
        params: { id: 7 },
      }),
    ).toBe(true);
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
    const { openPluginPanel, openThreadPanel, reveal } = renderSurface(surface);

    expect(openThreadPanel({ pluginId: "demo", actionId: "missing" })).toBe(
      false,
    );
    expect(openThreadPanel({ pluginId: "other", actionId: "board" })).toBe(
      false,
    );
    expect(
      openThreadPanel({
        pluginId: "demo",
        actionId: "board",
        params: { when: new Date() } as never,
      }),
    ).toBe(false);
    expect(openPluginPanel).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });

  it("publishes itself as the plugin command opener only while focused", () => {
    const unfocused = renderSurface(surface, false);
    expect(publishThreadPanelOpener).toHaveBeenLastCalledWith(
      unfocused.openThreadPanel,
      false,
    );

    const focused = renderSurface(surface, true);
    expect(publishThreadPanelOpener).toHaveBeenLastCalledWith(
      focused.openThreadPanel,
      true,
    );
  });
});
