import { useLayoutEffect, type ReactNode } from "react";
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ExperimentalOpenTabOptions,
  ExperimentalPanelController,
  ExperimentalPanelTabs,
  ExperimentalTabReference,
  JsonValue,
} from "@get-bb/plugin-sdk";
import {
  experimental_useAppPanel,
  experimental_useFixedTabTarget,
  experimental_usePanelTabs,
} from "@/lib/plugin-sdk-hooks";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
import {
  TabVisibleContext,
  useTabVisible,
} from "@/components/secondary-panel/tab-visibility";
import {
  createPluginPanelFixedPanelTab,
  type FixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import { serializePluginPanelParams } from "@/lib/plugin-json-value";

export const CONTRACT_PLUGIN_ID = "contract";

export interface PanelContractSnapshot {
  isOpen: boolean;
  activeTabId: string | null;
  tabIds: readonly string[];
}

interface ContractTab {
  tab: ExperimentalTabReference;
  panelTabId: string;
}

export interface PanelContractSurface {
  panel: () => ExperimentalPanelController;
  tabs: () => ExperimentalPanelTabs;
  snapshot: () => PanelContractSnapshot;
  renderedTarget: () => string | null;
  renderedTabVisible: () => string | null;
  command: (id: "panel.toggle") => boolean;
  action: {
    tab: ExperimentalTabReference;
    panelTabId: (params: JsonValue | undefined) => string;
  };
  fixed: { targeted: ContractTab; untargeted: ContractTab } | null;
  foreignTab: ExperimentalTabReference;
  toggleRestoresActiveTab: boolean;
}

export type MountPanelContractSurface = () => Promise<PanelContractSurface>;

export function isContractTarget(
  value: JsonValue,
): value is { recordId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.recordId === "string"
  );
}

export const contractTarget = { validate: isContractTarget };

export function ContractTargetedFixedTab({
  tab,
}: {
  tab: ExperimentalTabReference & { availability: "fixed" };
}) {
  const target = experimental_useFixedTabTarget({
    ...tab,
    experimental_target: contractTarget,
  });
  const visible = useTabVisible();
  return (
    <div data-testid="contract-fixed-tab">
      <output data-testid="contract-tab-visible">{String(visible)}</output>
      {target === null ? null : (
        <output data-testid="contract-target">
          {JSON.stringify(target.target)}
        </output>
      )}
    </div>
  );
}

const actionTabPanels = new Map<string, ExperimentalPanelController>();

export function ContractActionTab({ params }: { params: JsonValue | null }) {
  actionTabPanels.set(JSON.stringify(params), experimental_useAppPanel());
  return <div data-testid="contract-action-tab">{JSON.stringify(params)}</div>;
}

function actionTabPanel(params: JsonValue): ExperimentalPanelController {
  const panel = actionTabPanels.get(JSON.stringify(params));
  if (panel === undefined) {
    throw new Error(`action tab ${JSON.stringify(params)} has not rendered`);
  }
  return panel;
}

export interface ContractPanelRef {
  current: ExperimentalPanelController | null;
  tabs?: ExperimentalPanelTabs;
}

export function readContractPanel(ref: ContractPanelRef) {
  if (ref.current === null) throw new Error("panel probe has not rendered");
  return ref.current;
}

export function readContractTabs(ref: ContractPanelRef) {
  if (ref.tabs === undefined) throw new Error("panel probe has not rendered");
  return ref.tabs;
}

export function ContractPanelProbe({ probe }: { probe: ContractPanelRef }) {
  probe.current = experimental_useAppPanel();
  probe.tabs = experimental_usePanelTabs();
  return null;
}

function call<T>(run: () => T): T {
  let result!: T;
  act(() => {
    result = run();
  });
  return result;
}

function openFixed(surface: PanelContractSurface, entry: ContractTab) {
  return call(() => surface.panel().openTab({ tab: fixedTab(entry) }));
}

function fixedTab(entry: ContractTab) {
  return { ...entry.tab, availability: "fixed" } as const;
}

function actionOptions(
  surface: PanelContractSurface,
  params: JsonValue,
): ExperimentalOpenTabOptions {
  return {
    tab: { ...surface.action.tab, availability: "action" },
    params,
  };
}

function replaceOptions(
  surface: PanelContractSurface,
  params: JsonValue,
): ExperimentalOpenTabOptions {
  return {
    tab: { ...surface.action.tab, availability: "action" },
    params,
    experimental_replace: true,
  };
}

export interface PanelContractSupport {
  fixedTabs: boolean;
  replaceTabs: boolean;
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error("surface declared support it lacks");
  return value;
}

export function describePanelControllerContract(
  surfaceName: string,
  supports: PanelContractSupport,
  mount: MountPanelContractSurface,
) {
  describe(`panel controller contract: ${surfaceName}`, () => {
    beforeEach(() => {
      actionTabPanels.clear();
    });

    it.runIf(supports.fixedTabs)(
      "opens a fixed tab and reveals the side panel",
      async () => {
        const surface = await mount();
        const fixed = required(surface.fixed);
        call(() => surface.panel().close());
        expect(surface.snapshot().isOpen).toBe(false);
        expect(openFixed(surface, fixed.untargeted)).toBe(true);
        expect(surface.snapshot()).toMatchObject({
          isOpen: true,
          activeTabId: fixed.untargeted.panelTabId,
        });
      },
    );

    it.runIf(supports.fixedTabs)(
      "reports the shown tab visible only while the side panel is open",
      async () => {
        const surface = await mount();
        const { targeted } = required(surface.fixed);
        expect(
          call(() => surface.panel().openTab({ tab: fixedTab(targeted) })),
        ).toBe(true);
        expect(surface.renderedTabVisible()).toBe("true");
        expect(call(() => surface.panel().close())).toBe(true);
        expect(surface.renderedTabVisible()).not.toBe("true");
      },
    );

    it.runIf(supports.fixedTabs)(
      "delivers a valid fixed-tab target and declines invalid or unvalidated targets without changing state",
      async () => {
        const surface = await mount();
        const { targeted, untargeted } = required(surface.fixed);
        expect(
          call(() =>
            surface.panel().openTab({
              tab: fixedTab(targeted),
              target: { recordId: "r-1" },
            }),
          ),
        ).toBe(true);
        expect(surface.snapshot()).toMatchObject({
          isOpen: true,
          activeTabId: targeted.panelTabId,
        });
        expect(surface.renderedTarget()).toBe('{"recordId":"r-1"}');
        const before = surface.snapshot();
        expect(
          call(() =>
            surface
              .panel()
              .openTab({ tab: fixedTab(targeted), target: { recordId: 7 } }),
          ),
        ).toBe(false);
        expect(
          call(() =>
            surface.panel().openTab({
              tab: fixedTab(untargeted),
              target: { recordId: "r-2" },
            }),
          ),
        ).toBe(false);
        expect(surface.snapshot()).toEqual(before);
        expect(surface.renderedTarget()).toBe('{"recordId":"r-1"}');
      },
    );

    it.runIf(supports.fixedTabs)(
      "toggles a fixed tab closed only while it is selected and open, ignoring the target",
      async () => {
        const surface = await mount();
        const { targeted, untargeted } = required(surface.fixed);
        openFixed(surface, targeted);
        expect(
          call(() =>
            surface.panel().toggleTab({
              tab: fixedTab(targeted),
              target: { recordId: "ignored" },
            }),
          ),
        ).toBe(true);
        expect(surface.snapshot().isOpen).toBe(false);
        expect(
          call(() => surface.panel().toggleTab({ tab: fixedTab(targeted) })),
        ).toBe(true);
        expect(surface.snapshot()).toMatchObject({
          isOpen: true,
          activeTabId: targeted.panelTabId,
        });
        openFixed(surface, untargeted);
        expect(
          call(() => surface.panel().toggleTab({ tab: fixedTab(targeted) })),
        ).toBe(true);
        expect(surface.snapshot()).toMatchObject({
          isOpen: true,
          activeTabId: targeted.panelTabId,
        });
      },
    );

    it("focuses the action instance with the same params and opens siblings for different params", async () => {
      const surface = await mount();
      const one = surface.action.panelTabId({ n: 1 });
      const two = surface.action.panelTabId({ n: 2 });
      expect(
        call(() => surface.panel().openTab(actionOptions(surface, { n: 1 }))),
      ).toBe(true);
      expect(
        call(() => surface.panel().openTab(actionOptions(surface, { n: 2 }))),
      ).toBe(true);
      expect(
        call(() => surface.panel().openTab(actionOptions(surface, { n: 1 }))),
      ).toBe(true);
      const snapshot = surface.snapshot();
      expect(snapshot).toMatchObject({ isOpen: true, activeTabId: one });
      expect(snapshot.tabIds.filter((id) => id === one)).toHaveLength(1);
      expect(snapshot.tabIds.filter((id) => id === two)).toHaveLength(1);
    });

    it("toggles an action tab closed only when the instance with the same params is selected", async () => {
      const surface = await mount();
      call(() => surface.panel().openTab(actionOptions(surface, { n: 1 })));
      call(() => surface.panel().openTab(actionOptions(surface, { n: 2 })));
      expect(
        call(() => surface.panel().toggleTab(actionOptions(surface, { n: 1 }))),
      ).toBe(true);
      expect(surface.snapshot()).toMatchObject({
        isOpen: true,
        activeTabId: surface.action.panelTabId({ n: 1 }),
      });
      expect(
        call(() => surface.panel().toggleTab(actionOptions(surface, { n: 1 }))),
      ).toBe(true);
      expect(surface.snapshot().isOpen).toBe(false);
    });

    it("closes the side panel", async () => {
      const surface = await mount();
      call(() => surface.panel().openTab(actionOptions(surface, { n: 1 })));
      expect(surface.snapshot().isOpen).toBe(true);
      expect(call(() => surface.panel().close())).toBe(true);
      expect(surface.snapshot().isOpen).toBe(false);
    });

    it("declines unknown tabs, wrong contexts and wrong availability without changing state", async () => {
      const surface = await mount();
      call(() => surface.panel().openTab(actionOptions(surface, { n: 1 })));
      const before = surface.snapshot();
      const declined: ExperimentalOpenTabOptions[] = [
        {
          tab: { ...surface.action.tab, id: "missing", availability: "action" },
        },
        { tab: { ...surface.foreignTab, availability: "action" } },
        { tab: { ...surface.action.tab, availability: "fixed" } },
        ...(surface.fixed === null
          ? []
          : [
              {
                tab: {
                  ...surface.fixed.targeted.tab,
                  availability: "action",
                },
              } as const,
            ]),
      ];
      for (const options of declined) {
        expect(call(() => surface.panel().openTab(options))).toBe(false);
        expect(call(() => surface.panel().toggleTab(options))).toBe(false);
      }
      expect(surface.snapshot()).toEqual(before);
    });

    it("lists open tabs and selects or closes them by key, as the tab strip does", async () => {
      const surface = await mount();
      call(() => surface.panel().openTab(actionOptions(surface, { n: 1 })));
      call(() => surface.panel().openTab(actionOptions(surface, { n: 2 })));
      const first = surface.action.panelTabId({ n: 1 });
      const second = surface.action.panelTabId({ n: 2 });
      expect(surface.tabs().selectedKey).toBe(second);
      expect(surface.panel().getTabs()).toEqual(surface.tabs());
      expect(
        surface.tabs().tabs.find((tab) => tab.key === first),
      ).toMatchObject({
        closable: true,
        detail: {
          kind: "plugin",
          pluginId: CONTRACT_PLUGIN_ID,
          tab: { ...surface.action.tab, availability: "action" },
          params: { n: 1 },
        },
      });

      expect(call(() => surface.panel().selectTab(first))).toBe(true);
      expect(surface.snapshot().activeTabId).toBe(first);
      expect(surface.tabs().selectedKey).toBe(first);
      expect(call(() => surface.panel().closeTab(first))).toBe(true);
      expect(surface.snapshot().tabIds).not.toContain(first);
      expect(surface.tabs().tabs.map((tab) => tab.key)).not.toContain(first);
      expect(call(() => surface.panel().selectTab("missing"))).toBe(false);
      expect(call(() => surface.panel().closeTab("missing"))).toBe(false);

      call(() => surface.panel().close());
      expect(surface.snapshot().isOpen).toBe(false);
      expect(call(() => surface.panel().selectTab(second))).toBe(true);
      expect(surface.snapshot()).toMatchObject({
        isOpen: true,
        activeTabId: second,
      });
      expect(surface.tabs()).toMatchObject({ open: true, selectedKey: second });
    });

    it.runIf(supports.fixedTabs)(
      "lists fixed tabs as selectable but not closable",
      async () => {
        const surface = await mount();
        const { untargeted } = required(surface.fixed);
        call(() => surface.panel().close());
        const listed = surface
          .tabs()
          .tabs.find((tab) => tab.key === untargeted.panelTabId);
        expect(listed).toMatchObject({
          closable: false,
          detail: {
            kind: "plugin",
            pluginId: CONTRACT_PLUGIN_ID,
            tab: fixedTab(untargeted),
          },
        });
        expect(
          call(() => surface.panel().closeTab(untargeted.panelTabId)),
        ).toBe(false);
        expect(
          call(() => surface.panel().selectTab(untargeted.panelTabId)),
        ).toBe(true);
        expect(surface.snapshot()).toMatchObject({
          isOpen: true,
          activeTabId: untargeted.panelTabId,
        });
        expect(surface.tabs()).toMatchObject({
          open: true,
          selectedKey: untargeted.panelTabId,
        });
      },
    );

    it.runIf(supports.replaceTabs)(
      "replaces the calling action tab in its place with experimental_replace",
      async () => {
        const surface = await mount();
        const one = surface.action.panelTabId({ n: 1 });
        const three = surface.action.panelTabId({ n: 3 });
        call(() => surface.panel().openTab(actionOptions(surface, { n: 1 })));
        call(() => surface.panel().openTab(actionOptions(surface, { n: 2 })));
        call(() => surface.panel().selectTab(one));
        const { tabIds } = surface.snapshot();
        expect(
          call(() =>
            actionTabPanel({ n: 1 }).openTab(replaceOptions(surface, { n: 3 })),
          ),
        ).toBe(true);
        expect(surface.snapshot()).toEqual({
          isOpen: true,
          activeTabId: three,
          tabIds: tabIds.map((id) => (id === one ? three : id)),
        });
      },
    );

    it.runIf(supports.replaceTabs)(
      "keeps a replaced background tab in the background and a closed panel closed",
      async () => {
        const surface = await mount();
        const one = surface.action.panelTabId({ n: 1 });
        const two = surface.action.panelTabId({ n: 2 });
        call(() => surface.panel().openTab(actionOptions(surface, { n: 1 })));
        const background = actionTabPanel({ n: 1 });
        call(() => surface.panel().openTab(actionOptions(surface, { n: 2 })));
        const before = surface.snapshot().tabIds;
        expect(
          call(() => background.openTab(replaceOptions(surface, { n: 3 }))),
        ).toBe(true);
        expect(surface.snapshot()).toEqual({
          isOpen: true,
          activeTabId: two,
          tabIds: before.map((id) =>
            id === one ? surface.action.panelTabId({ n: 3 }) : id,
          ),
        });

        const shown = actionTabPanel({ n: 2 });
        call(() => surface.panel().close());
        expect(
          call(() => shown.openTab(replaceOptions(surface, { n: 4 }))),
        ).toBe(true);
        expect(surface.snapshot().isOpen).toBe(false);
        expect(surface.snapshot().tabIds).toContain(
          surface.action.panelTabId({ n: 4 }),
        );
        expect(surface.snapshot().tabIds).not.toContain(two);
      },
    );

    it.runIf(supports.replaceTabs)(
      "closes the calling tab onto an open tab with the same params",
      async () => {
        const surface = await mount();
        const one = surface.action.panelTabId({ n: 1 });
        const two = surface.action.panelTabId({ n: 2 });
        call(() => surface.panel().openTab(actionOptions(surface, { n: 1 })));
        call(() => surface.panel().openTab(actionOptions(surface, { n: 2 })));
        call(() => surface.panel().selectTab(one));
        expect(
          call(() =>
            actionTabPanel({ n: 1 }).openTab(replaceOptions(surface, { n: 2 })),
          ),
        ).toBe(true);
        const snapshot = surface.snapshot();
        expect(snapshot).toMatchObject({ isOpen: true, activeTabId: two });
        expect(snapshot.tabIds).not.toContain(one);
        expect(snapshot.tabIds.filter((id) => id === two)).toHaveLength(1);
      },
    );

    it("declines experimental_replace outside the plugin's own replaceable tab, and once that tab has closed", async () => {
      const surface = await mount();
      call(() => surface.panel().openTab(actionOptions(surface, { n: 1 })));
      const caller = actionTabPanel({ n: 1 });
      const unchanged = surface.snapshot();
      expect(
        call(() => surface.panel().openTab(replaceOptions(surface, { n: 2 }))),
      ).toBe(false);
      expect(surface.snapshot()).toEqual(unchanged);
      if (supports.replaceTabs) {
        call(() =>
          surface.panel().closeTab(surface.action.panelTabId({ n: 1 })),
        );
      }
      const before = surface.snapshot();
      expect(
        call(() => caller.openTab(replaceOptions(surface, { n: 3 }))),
      ).toBe(false);
      expect(surface.snapshot()).toEqual(before);
    });

    it("routes the panel.toggle command through the controller", async () => {
      const surface = await mount();
      call(() => surface.panel().openTab(actionOptions(surface, { n: 1 })));
      const active = surface.snapshot().activeTabId;
      expect(call(() => surface.command("panel.toggle"))).toBe(true);
      expect(surface.snapshot().isOpen).toBe(false);
      expect(call(() => surface.command("panel.toggle"))).toBe(true);
      expect(surface.snapshot().isOpen).toBe(true);
      if (surface.toggleRestoresActiveTab)
        expect(surface.snapshot().activeTabId).toBe(active);
    });
  });
}

interface ContractSecondaryPanelTab {
  tab: { id: string };
  renderContent?: (pane: {
    isFocused: boolean;
    onFocusPane: () => void;
  }) => ReactNode;
}

export function ContractSecondaryPanel({
  activeTab,
  fixedTabs,
  isOpen,
  tabs,
}: {
  activeTab: { id: string } | null;
  fixedTabs: readonly ContractSecondaryPanelTab[];
  isOpen: boolean;
  tabs: readonly ContractSecondaryPanelTab[];
}) {
  if (!isOpen) return null;
  const pane = { isFocused: true, onFocusPane: () => undefined };
  const active = [...fixedTabs, ...tabs].find(
    (tab) => tab.tab.id === activeTab?.id,
  );
  return (
    <aside>
      <TabVisibleContext.Provider value={isOpen}>
        {active?.renderContent?.(pane)}
      </TabVisibleContext.Provider>
    </aside>
  );
}

export interface ContractStateSink {
  current: FixedPanelTabsState | null;
}

function recordState(
  sink: ContractStateSink,
  state: FixedPanelTabsState,
): void {
  sink.current = state;
}

export function ContractStateProbe({
  panelStateId,
  sink,
  syncThreadId,
}: {
  panelStateId: string;
  sink: ContractStateSink;
  syncThreadId: string | null;
}) {
  const state = useFixedPanelTabsState(panelStateId, syncThreadId);
  useLayoutEffect(() => {
    recordState(sink, state);
  });
  return null;
}

export function snapshotFromState(
  sink: ContractStateSink,
): PanelContractSnapshot {
  const state = sink.current;
  if (state === null) throw new Error("state probe has not rendered");
  return {
    isOpen: state.secondary.isOpen,
    activeTabId: state.secondary.isOpen ? state.secondary.activeTabId : null,
    tabIds: state.secondary.tabs.map((tab) => tab.id),
  };
}

export function contractActionPanelTabId(actionId: string) {
  return (params: JsonValue | undefined) =>
    createPluginPanelFixedPanelTab({
      actionId,
      paramsJson: serializePluginPanelParams(params),
      pluginId: CONTRACT_PLUGIN_ID,
      title: "",
    }).id;
}
