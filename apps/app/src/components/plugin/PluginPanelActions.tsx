import { PluginTabScope } from "./PluginTabs";
import type {
  ExperimentalPluginActionContext,
  ExperimentalThreadEnvironment,
} from "@get-bb/plugin-sdk";
import { useMemo, type ReactNode, type RefObject } from "react";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import {
  usePluginFrontendSettled,
  usePluginSlotKind,
  type PluginNewThreadPanelActionSlot,
  isThreadTab,
  isNavTab,
  type PluginTabSlot,
} from "@/lib/plugin-slots";
import {
  createPluginPanelFixedPanelTab,
  type PluginPanelFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
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
  type AppFixedTabDestination,
} from "@/lib/app-fixed-tab-navigation";
import { createRetiredOpenPanel } from "@/lib/plugin-panel-controller";
import type { ResolvedAppNavigationHostCapabilities } from "@/lib/app-navigation-host";
import { useBindPluginActionContext } from "@/lib/plugin-action-context-provider";
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

interface PanelActionDestinationArgs {
  action: {
    pluginId: string;
    id: string;
    title: string;
    params?: import("@get-bb/plugin-sdk").JsonValue;
  };
  openPluginPanel: OpenPluginPanelHandler;
}

export function createPanelActionDestination({
  action,
  openPluginPanel,
}: PanelActionDestinationArgs): AppFixedTabDestination {
  const serializeParams = (
    params: import("@get-bb/plugin-sdk").JsonValue | undefined,
  ) =>
    serializePluginPanelParams(params === undefined ? action.params : params);
  return {
    tab: {
      ownerId: getThreadFixedTabOwnerId(action.pluginId),
      tabId: action.id,
    },
    availability: "action",
    panelTabId(params) {
      try {
        return createPluginPanelFixedPanelTab({
          actionId: action.id,
          paramsJson: serializeParams(params),
          pluginId: action.pluginId,
          title: action.title,
        }).id;
      } catch {
        return null;
      }
    },
    open(_target, options) {
      let paramsJson: string | null;
      try {
        paramsJson = serializeParams(options?.params);
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

function runPanelActionLauncher(
  action: { pluginId: string; id: string },
  slot: string,
  run: () => void | Promise<void>,
): void {
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${action.pluginId}] ${slot} "${action.id}" failed: ${describeError(error)}`,
    );
  };
  try {
    const result = run();
    if (result instanceof Promise) result.catch(warn);
  } catch (error) {
    warn(error);
  }
}

interface RunPluginPanelActionArgs {
  action: Extract<PluginTabSlot, { availability: "action" }>;
  context: import("./PluginTabs").PluginTabContext;
  actionContext: ExperimentalPluginActionContext;
}

export function runPluginPanelAction({
  action,
  context,
  actionContext,
}: RunPluginPanelActionArgs): void {
  const { panel } = actionContext;
  const ownTab = {
    id: action.id,
    context: action.context,
    availability: "action",
  } as const;
  const openPanel = createRetiredOpenPanel(panel, ownTab);
  runPanelActionLauncher(action, "threadPanelAction", () => {
    if (action.run === undefined) {
      panel.openTab({ tab: ownTab });
      return;
    }
    if (isThreadTab(action) && context.kind === "thread") {
      const runContext = {
        ...actionContext,
        threadId: context.threadId,
        environment: context.environment,
        openPanel,
      };
      return action.run(runContext);
    }
    if (isNavTab(action) && context.kind === "nav-panel") {
      const runContext = {
        ...actionContext,
        subPath: context.subPath,
        openPanel,
      };
      return action.run(runContext);
    }
  });
}

function runPluginNewThreadPanelAction({
  action,
  projectId,
  actionContext,
}: {
  action: PluginNewThreadPanelActionSlot;
  projectId: string | null;
  actionContext: ExperimentalPluginActionContext;
}): void {
  const { panel } = actionContext;
  const ownTab = {
    id: action.id,
    context: { kind: "thread" },
    availability: "action",
  } as const;
  const openPanel = createRetiredOpenPanel(panel, ownTab);
  runPanelActionLauncher(action, "experimental_newThreadPanelAction", () => {
    if (action.run === undefined) {
      panel.openTab({ tab: ownTab });
      return;
    }
    const runContext = { ...actionContext, projectId, openPanel };
    return action.run(runContext);
  });
}

export function usePluginPanelActions({
  hostRef,
  threadId,
  environmentId,
  actions,
}: {
  hostRef: RefObject<ResolvedAppNavigationHostCapabilities>;
  threadId: string | null | undefined;
  environmentId: string | null;
  actions: readonly Extract<
    PluginTabSlot,
    { context: { kind: "thread" }; availability: "action" }
  >[];
}): readonly PluginPanelActionEntry[] {
  const bind = useBindPluginActionContext();
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
          context: {
            kind: "thread",
            threadId,
            environment: environmentId === null ? null : { id: environmentId },
          },
          actionContext: bind(action.pluginId, () => hostRef.current),
        }),
    }));
  }, [actions, bind, environmentId, hostRef, threadId]);
}

export function usePluginNewThreadPanelActions({
  hostRef,
  projectId,
}: {
  hostRef: RefObject<ResolvedAppNavigationHostCapabilities>;
  projectId: string | null;
}): readonly PluginPanelActionEntry[] {
  const newThreadPanelActions = usePluginSlotKind("newThreadPanelActions");
  const bind = useBindPluginActionContext();
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
            projectId,
            actionContext: bind(action.pluginId, () => hostRef.current),
          }),
      })),
    [bind, hostRef, newThreadPanelActions, projectId],
  );
}

type PluginPanelSurfaceContext =
  | {
      kind: "thread";
      threadId: string;
      environment: ExperimentalThreadEnvironment | null;
    }
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

function UnavailableActionTab({ pluginId }: { pluginId: string }) {
  const pluginSettled = usePluginFrontendSettled(pluginId);
  if (!pluginSettled) {
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
  const tabs = usePluginSlotKind("tabs");
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
    return <UnavailableActionTab pluginId={tab.pluginId} />;
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
          <action.component
            threadId={context.threadId}
            environment={context.environment}
            params={params}
          />
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
  const newThreadPanelActions = usePluginSlotKind("newThreadPanelActions");
  const action =
    newThreadPanelActions.find(
      (candidate) =>
        candidate.pluginId === tab.pluginId && candidate.id === tab.actionId,
    ) ?? null;
  const params = usePersistedActionParams(tab);
  if (action === null) return <UnavailableActionTab pluginId={tab.pluginId} />;
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
  const fileOpeners = usePluginSlotKind("fileOpeners");
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
