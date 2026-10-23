import { PluginTabScope } from "./PluginTabs";
import { useMemo, type ReactNode } from "react";
import type { PluginPanelActionOpenOptions } from "@get-bb/plugin-sdk";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { usePluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import {
  usePluginSlots,
  type PluginNewThreadPanelActionSlot,
  isThreadTab,
  isNavTab,
  type PluginTabSlot,
} from "@/lib/plugin-slots";
import type { PluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  parsePersistedPluginPanelParams,
  serializePluginPanelParams,
} from "@/lib/plugin-json-value";
import {
  fileOpenerIdFromActionId,
  parseFileOpenerParams,
} from "./file-opener-tabs";
import { PluginSlotMount } from "./PluginSlotMount";
import { PluginReplacementSlot } from "./PluginReplacementSlot";
import { resolveReplacement } from "@/lib/plugin-slot-resolvers";

import {
  getThreadFixedTabOwnerId,
  openAppTabFromDestinations,
  type AppFixedTabDestination,
} from "@/lib/app-fixed-tab-navigation";
export interface OpenPluginPanelArgs {
  pluginId: string;
  actionId: string;
  title: string;
  paramsJson: string | null;
}

export type OpenPluginPanelHandler = (args: OpenPluginPanelArgs) => void;

export interface PluginPanelActionEntry {
  id: string;
  pluginId: string;
  icon: string | null;
  title: string;
  tooltip?: string;
  onSelect: () => void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PanelActionOpenPanelArgs {
  action: {
    pluginId: string;
    id: string;
    title: string;
    params?: import("@get-bb/plugin-sdk").JsonValue;
  };
  slot: string;
  openPluginPanel: OpenPluginPanelHandler;
}

export function createPanelActionDestination({
  action,
  openPluginPanel,
}: PanelActionOpenPanelArgs): AppFixedTabDestination {
  return {
    tab: {
      ownerId: getThreadFixedTabOwnerId(action.pluginId),
      tabId: action.id,
    },
    availability: "action",
    open(_target, options) {
      let paramsJson: string | null;
      try {
        paramsJson = serializePluginPanelParams(
          options?.params === undefined ? action.params : options.params,
        );
      } catch {
        return false;
      }
      openPluginPanel({
        pluginId: action.pluginId,
        actionId: action.id,
        title: options?.title ?? action.title,
        paramsJson,
      });
      return true;
    },
  };
}

export function createPanelActionOpenPanel(
  args: PanelActionOpenPanelArgs,
): (options?: PluginPanelActionOpenOptions) => boolean {
  const destination = createPanelActionDestination(args);
  return (options) => {
    const accepted = openAppTabFromDestinations([destination], {
      surface: { kind: "current" },
      tab: destination.tab,
      availability: "action",
      ...options,
    });
    if (!accepted)
      console.warn(
        `[plugin:${args.action.pluginId}] ${args.slot} "${args.action.id}" openPanel declined: params must be JSON values`,
      );
    return accepted;
  };
}

interface RunPluginPanelActionArgs {
  action: Extract<PluginTabSlot, { availability: "action" }>;
  openPluginPanel: OpenPluginPanelHandler;
  context:
    | { kind: "thread"; threadId: string }
    | { kind: "nav-panel"; subPath: string };
}

export function runPluginPanelAction({
  action,
  openPluginPanel,
  context,
}: RunPluginPanelActionArgs): void {
  const openPanel = createPanelActionOpenPanel({
    action,
    slot: "threadPanelAction",
    openPluginPanel,
  });
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${action.pluginId}] threadPanelAction "${action.id}" failed: ${describeError(error)}`,
    );
  };
  try {
    if (action.run === undefined) {
      openPanel();
      return;
    }
    const result =
      isThreadTab(action) && context.kind === "thread"
        ? action.run({ threadId: context.threadId, openPanel })
        : isNavTab(action) && context.kind === "nav-panel"
          ? action.run({ subPath: context.subPath, openPanel })
          : undefined;
    if (result instanceof Promise) result.catch(warn);
  } catch (error) {
    warn(error);
  }
}

interface RunPluginNewThreadPanelActionArgs {
  action: PluginNewThreadPanelActionSlot;
  openPluginPanel: OpenPluginPanelHandler;
  projectId: string | null;
}

function runPluginNewThreadPanelAction({
  action,
  openPluginPanel,
  projectId,
}: RunPluginNewThreadPanelActionArgs): void {
  const openPanel = createPanelActionOpenPanel({
    action,
    slot: "experimental_newThreadPanelAction",
    openPluginPanel,
  });
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${action.pluginId}] experimental_newThreadPanelAction "${action.id}" failed: ${describeError(error)}`,
    );
  };
  try {
    if (action.run === undefined) {
      openPanel();
      return;
    }
    const result = action.run({ projectId, openPanel });
    if (result instanceof Promise) result.catch(warn);
  } catch (error) {
    warn(error);
  }
}

export function usePluginPanelActions({
  openPluginPanel,
  threadId,
  actions,
}: {
  openPluginPanel: OpenPluginPanelHandler;
  threadId: string | null | undefined;
  actions: readonly Extract<
    PluginTabSlot,
    { context: { kind: "thread" }; availability: "action" }
  >[];
}): readonly PluginPanelActionEntry[] {
  return useMemo(() => {
    if (threadId === null || threadId === undefined || threadId.length === 0) {
      return [];
    }
    return actions.map((action) => ({
      id: `plugin-action:${action.pluginId}:${action.id}`,
      pluginId: action.pluginId,
      icon: action.icon ?? null,
      title: action.title,
      ...(action.tooltip === undefined ? {} : { tooltip: action.tooltip }),
      onSelect: () =>
        runPluginPanelAction({
          action,
          openPluginPanel,
          context: { kind: "thread", threadId },
        }),
    }));
  }, [openPluginPanel, threadId, actions]);
}

export function usePluginNewThreadPanelActions({
  openPluginPanel,
  projectId,
}: {
  openPluginPanel: OpenPluginPanelHandler;
  projectId: string | null;
}): readonly PluginPanelActionEntry[] {
  const { newThreadPanelActions } = usePluginSlots();
  return useMemo(
    () =>
      newThreadPanelActions.map((action) => ({
        id: `plugin-new-thread-action:${action.pluginId}:${action.id}`,
        pluginId: action.pluginId,
        icon: action.icon ?? null,
        title: action.title,
        onSelect: () =>
          runPluginNewThreadPanelAction({
            action,
            openPluginPanel,
            projectId,
          }),
      })),
    [newThreadPanelActions, openPluginPanel, projectId],
  );
}

type PluginPanelSurfaceContext =
  | { kind: "thread"; threadId: string }
  | { kind: "new-thread"; projectId: string | null }
  | { kind: "nav-panel"; pluginId: string; panelId: string; subPath: string };

export function PluginPanelTabContent({
  tab,
  context,
  fileOpenerOriginal,
}: {
  tab: PluginPanelFixedPanelTab;
  context: PluginPanelSurfaceContext;
  fileOpenerOriginal?: ReactNode;
}) {
  const openerId = fileOpenerIdFromActionId(tab.actionId);
  if (openerId !== null) {
    return (
      <FileOpenerTabContent
        openerId={openerId}
        original={fileOpenerOriginal}
        tab={tab}
      />
    );
  }
  return context.kind !== "new-thread" ? (
    <RegisteredActionTabContent tab={tab} context={context} />
  ) : (
    <NewThreadActionTabContent tab={tab} projectId={context.projectId} />
  );
}

function UnavailableActionTab() {
  const pluginsSettled = usePluginFrontendsSettled();
  if (!pluginsSettled) {
    return null;
  }
  return (
    <div className="p-4">
      <EmptyStatePanel className="rounded-lg p-6 text-sm">
        This plugin tab is not available. The plugin may still be loading, or it
        has been disabled or removed.
      </EmptyStatePanel>
    </div>
  );
}

function PanelActionTabFrame({
  layout,
  testId,
  children,
}: {
  layout: "padded" | "flush" | undefined;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      className={
        layout === "flush"
          ? "h-full min-h-0 flex-1 overflow-hidden"
          : "h-full min-h-0 flex-1 overflow-y-auto p-4"
      }
      data-testid={testId}
    >
      {children}
    </div>
  );
}

function usePersistedActionParams(tab: PluginPanelFixedPanelTab) {
  return useMemo(
    () => parsePersistedPluginPanelParams(tab.paramsJson),
    [tab.paramsJson],
  );
}

function RegisteredActionTabContent({
  tab,
  context,
}: {
  tab: PluginPanelFixedPanelTab;
  context: Exclude<PluginPanelSurfaceContext, { kind: "new-thread" }>;
}) {
  const { tabs } = usePluginSlots();
  const action = tabs.find(
    (candidate) =>
      candidate.pluginId === tab.pluginId &&
      candidate.id === tab.actionId &&
      candidate.availability === "action" &&
      (candidate.context.kind === "thread"
        ? context.kind === "thread"
        : context.kind === "nav-panel" &&
          candidate.context.panelId === context.panelId &&
          candidate.pluginId === context.pluginId),
  );
  const params = usePersistedActionParams(tab);
  if (action === undefined && context.kind === "nav-panel")
    return <NewThreadActionTabContent tab={tab} projectId={null} />;
  if (action === undefined || action.availability !== "action")
    return <UnavailableActionTab />;
  return (
    <PanelActionTabFrame
      layout={action.layout}
      testId="plugin-panel-tab-content"
    >
      <PluginTabScope
        slot={action}
        instanceId={`${context.kind}/${context.kind === "thread" ? context.threadId : `${context.panelId}/${context.subPath}`}/${tab.id}`}
      >
        {isThreadTab(action) && context.kind === "thread" ? (
          <action.component threadId={context.threadId} params={params} />
        ) : isNavTab(action) && context.kind === "nav-panel" ? (
          <action.component subPath={context.subPath} params={params} />
        ) : null}
      </PluginTabScope>
    </PanelActionTabFrame>
  );
}

function NewThreadActionTabContent({
  tab,
  projectId,
}: {
  tab: PluginPanelFixedPanelTab;
  projectId: string | null;
}) {
  const { newThreadPanelActions } = usePluginSlots();
  const action =
    newThreadPanelActions.find(
      (candidate) =>
        candidate.pluginId === tab.pluginId && candidate.id === tab.actionId,
    ) ?? null;
  const params = usePersistedActionParams(tab);
  if (action === null) return <UnavailableActionTab />;
  return (
    <PanelActionTabFrame
      layout={action.layout}
      testId="plugin-new-thread-panel-tab-content"
    >
      <PluginSlotMount
        key={`new-thread/${action.pluginId}/${action.id}/${action.generation}`}
        pluginId={action.pluginId}
        slotKind="newThreadPanelAction"
        slotId={action.id}
      >
        <action.component projectId={projectId} params={params} />
      </PluginSlotMount>
    </PanelActionTabFrame>
  );
}

function FileOpenerTabContent({
  openerId,
  original,
  tab,
}: {
  openerId: string;
  original: ReactNode | undefined;
  tab: PluginPanelFixedPanelTab;
}) {
  const { fileOpeners } = usePluginSlots();
  const replacement = resolveReplacement(
    fileOpeners,
    (candidate) =>
      candidate.pluginId === tab.pluginId && candidate.id === openerId,
  );
  const file = useMemo(
    () => parseFileOpenerParams(tab.paramsJson),
    [tab.paramsJson],
  );
  const owner = tab.fileOpenerOwner;
  const lineRange = useMemo(() => {
    const range = owner?.tab.lineRange;
    return range == null ? null : { ...range };
  }, [owner]);
  if (file === null || owner === undefined || original === undefined) {
    return <UnavailableFileOpenerTab />;
  }
  return (
    <PluginReplacementSlot
      replacement={replacement}
      original={original}
      slotKind="fileOpener"
    >
      {(opener, BoundOriginal) => (
        <div
          className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
          data-testid="plugin-file-opener-tab-content"
        >
          <opener.component
            path={file.path}
            source={file.source}
            experimental_lineRange={lineRange}
            Original={BoundOriginal}
          />
        </div>
      )}
    </PluginReplacementSlot>
  );
}

function UnavailableFileOpenerTab() {
  return (
    <div className="p-4">
      <EmptyStatePanel className="rounded-lg p-6 text-sm">
        This file opener is not available. The plugin may still be loading, or
        it has been disabled or removed — reopen the file to use the built-in
        preview.
      </EmptyStatePanel>
    </div>
  );
}
