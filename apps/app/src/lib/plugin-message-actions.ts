import type {
  PluginMessageActionContext,
  ThreadChatMessageReference,
} from "@get-bb/plugin-sdk";
import type { MarkdownMessageDirectiveOpenThreadPanel } from "@/components/ui/markdown-message-directives";
import type { PluginMessageActionSlot } from "./plugin-slots";

/**
 * Bridge between plugin `messageAction` registrations and the timeline's
 * per-message chrome. Actions run in host chrome, so a plugin's `run` must
 * never break the timeline: errors (sync or async) are contained and logged
 * here, mirroring the other host-run registration callbacks
 * (sidebarFooterAction, threadPanelAction).
 */

export interface RunPluginMessageActionArgs {
  slot: PluginMessageActionSlot;
  threadId: string;
  message: ThreadChatMessageReference;
  /** Present only for selection-menu invocations. */
  selectedText?: string;
  /**
   * The surface's thread-panel opener (same one message directives use), or
   * undefined on surfaces without a side panel — `openPanel` then reports
   * false to the plugin instead of throwing.
   */
  openThreadPanel: MarkdownMessageDirectiveOpenThreadPanel | undefined;
}

export function runPluginMessageAction({
  slot,
  threadId,
  message,
  selectedText,
  openThreadPanel,
}: RunPluginMessageActionArgs): void {
  const context: PluginMessageActionContext = {
    threadId,
    message,
    ...(selectedText !== undefined ? { selectedText } : {}),
    openPanel: (options) => {
      if (openThreadPanel === undefined) {
        // Reachable: only the main thread view supplies an opener, so a
        // ThreadChat a plugin embeds in its own panel declines here. Logged
        // so the false is diagnosable from the console.
        console.warn(
          `[plugin:${slot.pluginId}] messageAction "${slot.id}" openPanel declined: this surface has no thread side panel`,
        );
        return false;
      }
      return openThreadPanel({ ...options, pluginId: slot.pluginId });
    },
  };
  const warn = (error: unknown) => {
    console.warn(
      `[plugin:${slot.pluginId}] messageAction "${slot.id}" failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  };
  try {
    const result = slot.run(context);
    if (result instanceof Promise) {
      result.catch(warn);
    }
  } catch (error) {
    warn(error);
  }
}
