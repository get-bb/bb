import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginTimelineRendererProps } from "@get-bb/plugin-sdk";
import {
  getPluginSlotSnapshot,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "./plugin-slots";
import { resolveTimelineRenderer } from "./plugin-slot-resolvers";

function Renderer(_props: PluginTimelineRendererProps) {
  return null;
}

function registrationSet(
  overrides: Partial<PluginRegistrationSet> = {},
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerCustomizations: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

afterEach(() => {
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

/**
 * Q17: a plugin renders only its own rows — its extension kinds and the
 * generic tool items of its providers. The store drops a kind in another
 * plugin's namespace; the resolver scopes `"tool"` to the thread's provider
 * plugin.
 */
describe("experimental_timelineRenderer slots", () => {
  it("keeps a plugin's own kinds and drops a kind in another plugin's namespace", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "echo-provider",
      registrationSet({
        timelineRenderers: [
          { kind: "echo-provider/receipt", component: Renderer },
          { kind: "tool", component: Renderer },
          { kind: "provider-codex/goal", component: Renderer },
        ],
      }),
    );
    const slots = getPluginSlotSnapshot().timelineRenderers;
    expect(slots.map((slot) => slot.kind)).toEqual([
      "echo-provider/receipt",
      "tool",
    ]);
    expect(slots.every((slot) => slot.pluginId === "echo-provider")).toBe(
      true,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('timeline renderer for "provider-codex/goal"'),
    );
  });

  it("resolves an extension row by kind and a tool row by the thread's provider plugin", () => {
    setPluginSlotRegistrations(
      "echo-provider",
      registrationSet({
        timelineRenderers: [
          { kind: "echo-provider/receipt", component: Renderer },
          { kind: "tool", component: Renderer },
        ],
      }),
    );
    setPluginSlotRegistrations(
      "provider-codex",
      registrationSet({
        timelineRenderers: [{ kind: "tool", component: Renderer }],
      }),
    );
    const slots = getPluginSlotSnapshot().timelineRenderers;

    expect(
      resolveTimelineRenderer(slots, {
        kind: "extension",
        extensionKind: "echo-provider/receipt",
      })?.pluginId,
    ).toBe("echo-provider");
    expect(
      resolveTimelineRenderer(slots, {
        kind: "extension",
        extensionKind: "echo-provider/mood",
      }),
    ).toBeNull();

    // A tool row belongs to the plugin that owns the thread's provider.
    expect(
      resolveTimelineRenderer(slots, {
        kind: "tool",
        providerPluginId: "provider-codex",
      })?.pluginId,
    ).toBe("provider-codex");
    expect(
      resolveTimelineRenderer(slots, {
        kind: "tool",
        providerPluginId: "echo-provider",
      })?.pluginId,
    ).toBe("echo-provider");
    // Unknown provider owner: no plugin may claim the row.
    expect(
      resolveTimelineRenderer(slots, { kind: "tool", providerPluginId: null }),
    ).toBeNull();
  });
});
