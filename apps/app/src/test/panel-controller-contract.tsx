import { useLayoutEffect, type ReactNode } from "react";
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  ExperimentalOpenTabOptions,
  ExperimentalPanelController,
  ExperimentalTabReference,
  JsonValue,
} from "@get-bb/plugin-sdk";
import {
  experimental_useAppPanel,
  experimental_useFixedTabTarget,
} from "@/lib/plugin-sdk-hooks";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
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
  snapshot: () => PanelContractSnapshot;
  renderedTarget: () => string | null;
  command: (id: "panel.toggle" | "diff.toggle") => boolean;
  action: {
    tab: ExperimentalTabReference;
    panelTabId: (params: JsonValue | undefined) => string;
  };
  fixed: { targeted: ContractTab; untargeted: ContractTab } | null;
  foreignTab: ExperimentalTabReference;
  diff: { panelTabId: string } | null;
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
  return (
    <div data-testid="contract-fixed-tab">
      {target === null ? null : (
        <output data-testid="contract-target">
          {JSON.stringify(target.target)}
        </output>
      )}
    </div>
  );
}

export function ContractActionTab({ params }: { params: JsonValue | null }) {
  return <div data-testid="contract-action-tab">{JSON.stringify(params)}</div>;
}

export interface ContractPanelRef {
  current: ExperimentalPanelController | null;
}

export function readContractPanel(ref: ContractPanelRef) {
  if (ref.current === null) throw new Error("panel probe has not rendered");
  return ref.current;
}

export function ContractPanelProbe({ probe }: { probe: ContractPanelRef }) {
  probe.current = experimental_useAppPanel();
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

export interface PanelContractSupport {
  fixedTabs: boolean;
  diffToggle: boolean;
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

    it.runIf(supports.diffToggle)(
      "toggles the core Diff tab with diff.toggle",
      async () => {
        const surface = await mount();
        const diff = required(surface.diff);
        expect(call(() => surface.command("diff.toggle"))).toBe(true);
        expect(surface.snapshot()).toMatchObject({
          isOpen: true,
          activeTabId: diff.panelTabId,
        });
        expect(call(() => surface.command("diff.toggle"))).toBe(true);
        expect(surface.snapshot().isOpen).toBe(false);
      },
    );
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
  return <aside>{active?.renderContent?.(pane)}</aside>;
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
