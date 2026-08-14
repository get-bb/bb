import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PluginHomepageSectionProps,
  PluginMessageDirectiveProps,
  PluginNavPanelProps,
} from "@get-bb/plugin-sdk";
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
function DirectiveComponent(_props: PluginMessageDirectiveProps) {
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
        composerCustomizations: [
          {
            id: "pick",
            actions: [{ id: "pick", component: SectionComponent }],
          },
        ],
      }),
    );

    const snapshot = getPluginSlotSnapshot();
    expect(
      snapshot.homepageSections.map((section) => section.pluginId),
    ).toEqual(["alpha", "zeta"]);
    expect(snapshot.composerCustomizations).toHaveLength(1);
    expect(snapshot.composerCustomizations[0]?.pluginId).toBe("alpha");
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

  it("keeps New thread actions separate from thread-scoped actions", () => {
    const ActionComponent = () => null;
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelActions: [
          { id: "thread", title: "Thread", component: ActionComponent },
        ],
        newThreadPanelActions: [
          { id: "compose", title: "Compose", component: ActionComponent },
        ],
      }),
    );

    const snapshot = getPluginSlotSnapshot();
    expect(snapshot.threadPanelActions.map((action) => action.id)).toEqual([
      "thread",
    ]);
    expect(snapshot.newThreadPanelActions.map((action) => action.id)).toEqual([
      "compose",
    ]);
  });

  it("replaces composer customizations wholesale with generation metadata", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        composerCustomizations: [{ id: "first" }, { id: "second" }],
      }),
    );
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        composerCustomizations: [{ id: "replacement" }],
      }),
    );

    expect(
      getPluginSlotSnapshot().composerCustomizations.map((registration) => ({
        id: registration.id,
        pluginId: registration.pluginId,
        generation: registration.generation,
      })),
    ).toEqual([{ id: "replacement", pluginId: "demo", generation: 2 }]);
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

  it("flattens messageDirectives sorted by plugin id with generation metadata", () => {
    setPluginSlotRegistrations(
      "zeta",
      registrationSet({
        messageDirectives: [{ id: "z-vis", component: DirectiveComponent }],
      }),
    );
    setPluginSlotRegistrations(
      "alpha",
      registrationSet({
        messageDirectives: [
          { id: "inline-vis", component: DirectiveComponent },
          { id: "chart", component: DirectiveComponent },
        ],
      }),
    );

    const snapshot = getPluginSlotSnapshot();
    expect(
      snapshot.messageDirectives.map((directive) => ({
        pluginId: directive.pluginId,
        id: directive.id,
        generation: directive.generation,
      })),
    ).toEqual([
      { pluginId: "alpha", id: "inline-vis", generation: 1 },
      { pluginId: "alpha", id: "chart", generation: 1 },
      { pluginId: "zeta", id: "z-vis", generation: 1 },
    ]);
  });

  it("replaces and removes messageDirectives on reload/uninstall", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        messageDirectives: [
          { id: "inline-vis", component: DirectiveComponent },
        ],
      }),
    );
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        messageDirectives: [{ id: "chart", component: DirectiveComponent }],
      }),
    );

    let snapshot = getPluginSlotSnapshot();
    expect(snapshot.messageDirectives.map((d) => d.id)).toEqual(["chart"]);
    expect(snapshot.messageDirectives[0]?.generation).toBe(2);

    removePluginSlotRegistrations("demo");
    snapshot = getPluginSlotSnapshot();
    expect(snapshot.messageDirectives).toHaveLength(0);
  });
});
