import { useMemo } from "react";
import type { ExperimentalPluginBrowserPage } from "@get-bb/plugin-sdk";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import {
  usePluginSlots,
  type PluginBrowserToolbarActionSlot,
} from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

interface CreatePluginBrowserPageArgs {
  desktopBrowser: BbDesktopBrowserApi | null;
  pluginId: string;
  tabId: string;
}

export function createPluginBrowserPage({
  desktopBrowser,
  pluginId,
  tabId,
}: CreatePluginBrowserPageArgs): ExperimentalPluginBrowserPage | null {
  const evaluate = desktopBrowser?.evaluate;
  const onPageMessage = desktopBrowser?.onPageMessage;
  if (evaluate === undefined || onPageMessage === undefined) {
    return null;
  }
  return {
    async evaluate(expression, options) {
      const result = await evaluate({
        tabId,
        expression,
        world: options?.world ?? "isolated",
        channel: pluginId,
      });
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.value;
    },
    onMessage(listener) {
      return onPageMessage((message) => {
        if (message.tabId === tabId && message.channel === pluginId) {
          listener(message.data);
        }
      });
    },
  };
}

interface PluginBrowserToolbarActionProps {
  slot: PluginBrowserToolbarActionSlot;
  threadId: string;
  tabId: string;
  url: string;
  isCompactViewport: boolean;
}

function PluginBrowserToolbarAction({
  slot,
  threadId,
  tabId,
  url,
  isCompactViewport,
}: PluginBrowserToolbarActionProps) {
  const page = useMemo(
    () =>
      createPluginBrowserPage({
        desktopBrowser: getDesktopBrowserApi(),
        pluginId: slot.pluginId,
        tabId,
      }),
    [slot.pluginId, tabId],
  );
  const Component = slot.component;
  return (
    <PluginSlotMount
      pluginId={slot.pluginId}
      slotKind="browserToolbarAction"
      slotId={slot.id}
      instanceId={`${threadId}/${tabId}`}
      crashFallback={null}
    >
      <span
        role="group"
        aria-label={slot.title}
        className="flex shrink-0 items-center"
      >
        <Component
          threadId={threadId}
          tabId={tabId}
          url={url}
          isCompactViewport={isCompactViewport}
          experimental_page={page}
        />
      </span>
    </PluginSlotMount>
  );
}

export function PluginBrowserToolbarActions({
  threadId,
  tabId,
  url,
  isCompactViewport,
}: {
  threadId: string;
  tabId: string;
  url: string;
  isCompactViewport: boolean;
}) {
  const { browserToolbarActions } = usePluginSlots();

  if (browserToolbarActions.length === 0) return null;

  return browserToolbarActions.map((slot) => (
    <PluginBrowserToolbarAction
      key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}/${tabId}`}
      slot={slot}
      threadId={threadId}
      tabId={tabId}
      url={url}
      isCompactViewport={isCompactViewport}
    />
  ));
}
