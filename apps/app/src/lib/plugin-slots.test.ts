import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginNavPanelProps, PluginHomepageSectionProps } from "@bb/plugin-sdk";
import {
  getPluginSlotSnapshot,
  removePluginSlotRegistrations,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  subscribePluginSlots,
  type PluginRegistrationSet,
} from "./plugin-slots";

function SectionComponent(_props: Partial<PluginHomepageSectionProps>) {
  return null;
}
function PanelComponent(_props: PluginNavPanelProps) {
  return null;
}

function registrationSet(
  overrides: Partial<PluginRegistrationSet> = {},
): PluginRegistrationSet {
  return {
    homepageSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerAccessories: [],
    fileOpeners: [],
    ...overrides,
  };
}

afterEach(() => {
  resetPluginSlotStoreForTest();
});

describe("plugin slot store", () => {
  it("registers per plugin and flattens sorted by plugin id", () => {
    setPluginSlotRegistrations(
      "zeta",
      registrationSet({
        homepageSections: [
          { id: "z", title: "Zeta", component: SectionComponent },
        ],
      }),
    );
    setPluginSlotRegistrations(
      "alpha",
      registrationSet({
        homepageSections: [
          { id: "a", title: "Alpha", component: SectionComponent },
        ],
        composerAccessories: [{ id: "pick", component: SectionComponent }],
      }),
    );

    const snapshot = getPluginSlotSnapshot();
    expect(
      snapshot.homepageSections.map((section) => section.pluginId),
    ).toEqual(["alpha", "zeta"]);
    expect(snapshot.composerAccessories).toHaveLength(1);
    expect(snapshot.composerAccessories[0]?.pluginId).toBe("alpha");
  });

  it("replaces a plugin's registrations wholesale (never appends)", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        homepageSections: [
          { id: "one", title: "One", component: SectionComponent },
          { id: "two", title: "Two", component: SectionComponent },
        ],
      }),
    );
    // Re-registering (as a P3.4 reload would) must drop the old entries.
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        homepageSections: [
          { id: "three", title: "Three", component: SectionComponent },
        ],
      }),
    );

    const snapshot = getPluginSlotSnapshot();
    expect(snapshot.homepageSections.map((section) => section.id)).toEqual([
      "three",
    ]);
    // The generation bumps per replacement so mount sites can remount slot
    // components (fresh error-boundary state) on reload.
    expect(snapshot.homepageSections[0]?.generation).toBe(2);
  });

  it("removes a plugin's registrations and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePluginSlots(listener);
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [
          {
            id: "board",
            title: "Board",
            icon: "columns",
            path: "board",
            component: PanelComponent,
          },
        ],
      }),
    );
    expect(listener).toHaveBeenCalledTimes(1);

    removePluginSlotRegistrations("demo");
    expect(getPluginSlotSnapshot().navPanels).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(2);

    // Removing an unknown plugin is a no-op (no extra notification).
    removePluginSlotRegistrations("demo");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("returns a stable snapshot object between changes", () => {
    setPluginSlotRegistrations("demo", registrationSet());
    const first = getPluginSlotSnapshot();
    expect(getPluginSlotSnapshot()).toBe(first);
  });
});
