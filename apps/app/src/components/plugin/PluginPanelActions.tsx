import { useMemo } from "react";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import {
  usePluginSlots,
  type PluginThreadPanelActionSlot,
} from "@/lib/plugin-slots";
import type { PluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  fileOpenerIdFromActionId,
  parseFileOpenerParams,
} from "./file-opener-tabs";
import { PluginSlotMount } from "./PluginSlotMount";

/**
 * Plugin `threadPanelAction` slots (plugin design §5.2): rows in the
 * secondary panel's new-tab Actions list. Activating one runs the plugin's
 * `run` (contained: a throw/rejection is logged and never breaks the
 * launcher), whose `openPanel` opens closable file-strip tabs rendering the
 * action's component with persisted JSON params.
 */

/** Host-side open request produced by an action's `openPanel`. */
export interface OpenPluginPanelArgs {
  pluginId: string;
  actionId: string;
  title: string;
  paramsJson: string | null;
}

export type OpenPluginPanelHandler = (args: OpenPluginPanelArgs) => void;

/** One launcher row for a plugin action, ready to render + invoke. */
export interface PluginPanelActionEntry {
  /** Launcher row id, unique across plugins. */
  id: string;
  pluginId: string;
  /** Named-icon hint (used only when the plugin ships no logo). */
  icon: string | null;
  title: string;
  onSelect: () => void;
}

interface RunPluginPanelActionArgs {
  action: PluginThreadPanelActionSlot;
  openPluginPanel: OpenPluginPanelHandler;
  threadId: string;
}

function runPluginPanelAction({
  action,
  openPluginPanel,
  threadId,
}: RunPluginPanelActionArgs): void {
  const openPanel = (options?: { title?: string; params?: unknown }) => {
    let paramsJson: string | null = null;
    if (options?.params !== undefined) {
      try {
        paramsJson = JSON.stringify(options.params) ?? null;
      } catch (error) {
        throw new Error(
          `openPanel "params" must be JSON-serializable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    openPluginPanel({
      pluginId: action.pluginId,
      actionId: action.id,
      title: options?.title ?? action.title,
      paramsJson,
    });
  };
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${action.pluginId}] threadPanelAction "${action.id}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  };
  try {
    if (action.run === undefined) {
      openPanel();
      return;
    }
    const result = action.run({ threadId, openPanel });
    if (result instanceof Promise) result.catch(warn);
  } catch (error) {
    warn(error);
  }
}

/**
 * Every registered plugin action as a launcher entry for the given thread.
 * Empty outside a thread context (actions are thread-scoped).
 */
export function usePluginPanelActions({
  openPluginPanel,
  threadId,
}: {
  openPluginPanel: OpenPluginPanelHandler;
  threadId: string | null | undefined;
}): readonly PluginPanelActionEntry[] {
  const { threadPanelActions } = usePluginSlots();
  return useMemo(() => {
    if (threadId === null || threadId === undefined || threadId.length === 0) {
      return [];
    }
    return threadPanelActions.map((action) => ({
      id: `plugin-action:${action.pluginId}:${action.id}`,
      pluginId: action.pluginId,
      icon: action.icon ?? null,
      title: action.title,
      onSelect: () =>
        runPluginPanelAction({ action, openPluginPanel, threadId }),
    }));
  }, [openPluginPanel, threadId, threadPanelActions]);
}

/**
 * The content region of an open plugin panel tab. A persisted tab can
 * outlive its plugin (disabled/removed) or render before plugin frontends
 * finish loading — those degrade to a placeholder instead of crashing.
 */
export function PluginPanelTabContent({
  tab,
  threadId,
}: {
  tab: PluginPanelFixedPanelTab;
  threadId: string | null | undefined;
}) {
  const openerId = fileOpenerIdFromActionId(tab.actionId);
  if (openerId !== null) {
    return <FileOpenerTabContent openerId={openerId} tab={tab} />;
  }
  return <ActionTabContent tab={tab} threadId={threadId} />;
}

function ActionTabContent({
  tab,
  threadId,
}: {
  tab: PluginPanelFixedPanelTab;
  threadId: string | null | undefined;
}) {
  const { threadPanelActions } = usePluginSlots();
  const action =
    threadPanelActions.find(
      (candidate) =>
        candidate.pluginId === tab.pluginId && candidate.id === tab.actionId,
    ) ?? null;
  // Parsed once per persisted payload, so the component sees a stable params
  // identity across unrelated re-renders.
  const params = useMemo(() => {
    if (tab.paramsJson === null) return null;
    try {
      return JSON.parse(tab.paramsJson) as unknown;
    } catch {
      return null;
    }
  }, [tab.paramsJson]);
  if (action === null || !threadId) {
    return (
      <div className="p-4">
        <EmptyStatePanel className="rounded-lg p-6 text-sm">
          This plugin tab is not available. The plugin may still be loading,
          or it has been disabled or removed.
        </EmptyStatePanel>
      </div>
    );
  }
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto p-4"
      data-testid="plugin-panel-tab-content"
    >
      <PluginSlotMount
        // Generation in the key: a P3.4 reload remounts the slot (fresh
        // error-boundary state).
        key={`${action.pluginId}/${action.id}/${action.generation}`}
        pluginId={action.pluginId}
        slotKind="threadPanelAction"
        slotId={action.id}
      >
        <action.component threadId={threadId} params={params} />
      </PluginSlotMount>
    </div>
  );
}

/**
 * A file diverted to a plugin `fileOpener` (see file-opener-tabs.ts). Same
 * degrade rules as action tabs: missing opener/plugin or unparsable params
 * render a placeholder, never a crash.
 */
function FileOpenerTabContent({
  openerId,
  tab,
}: {
  openerId: string;
  tab: PluginPanelFixedPanelTab;
}) {
  const { fileOpeners } = usePluginSlots();
  const opener =
    fileOpeners.find(
      (candidate) =>
        candidate.pluginId === tab.pluginId && candidate.id === openerId,
    ) ?? null;
  const file = useMemo(
    () => parseFileOpenerParams(tab.paramsJson),
    [tab.paramsJson],
  );
  if (opener === null || file === null) {
    return (
      <div className="p-4">
        <EmptyStatePanel className="rounded-lg p-6 text-sm">
          This file opener is not available. The plugin may still be loading,
          or it has been disabled or removed — reopen the file to use the
          built-in preview.
        </EmptyStatePanel>
      </div>
    );
  }
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="plugin-file-opener-tab-content"
    >
      <PluginSlotMount
        key={`${opener.pluginId}/${opener.id}/${opener.generation}`}
        pluginId={opener.pluginId}
        slotKind="fileOpener"
        slotId={opener.id}
      >
        <opener.component path={file.path} source={file.source} />
      </PluginSlotMount>
    </div>
  );
}
