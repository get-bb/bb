// bb-plugin-thread-chat-demo — the frontend bundle.
//
// Demonstrates the two chat-integration surfaces added for the sidechat
// rebuild:
//
// - `ThreadChat`, the one host-owned SDK component: a nav panel that renders
//   any thread's full chat (timeline + composer) from just a thread id, and
//   a thread panel that renders the current thread compactly.
// - `messageAction`, host-rendered chrome on every chat message (and the
//   text-selection menu): "Open in demo panel" opens this plugin's own
//   thread panel anchored on the clicked message via `openPanel`.
import { useState } from "react";
import {
  definePluginApp,
  ThreadChat,
  useBbContext,
} from "@get-bb/plugin-sdk/app";

function ThreadChatDemoPanel({ subPath }: { subPath: string }) {
  const { threadId: routeThreadId } = useBbContext();
  const [threadId, setThreadId] = useState(subPath);
  const [focusRequest, setFocusRequest] = useState(0);
  const activeThreadId = threadId || routeThreadId || "";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-2">
        <input
          className="h-8 flex-1 rounded-md border bg-transparent px-2 text-sm"
          placeholder="Thread id (thr_…)"
          value={threadId}
          onChange={(event) => setThreadId(event.target.value.trim())}
        />
        <button
          type="button"
          className="h-8 cursor-pointer rounded-md border px-2 text-sm hover:bg-surface-recessed"
          onClick={() => setFocusRequest((nonce) => nonce + 1)}
        >
          Focus composer
        </button>
      </div>
      {activeThreadId ? (
        <ThreadChat
          threadId={activeThreadId}
          variant="full"
          layout="contained"
          focusRequest={focusRequest}
          className="min-h-0 flex-1"
        />
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          Enter a thread id above (or open the panel from a thread route) to
          render its chat here.
        </p>
      )}
    </div>
  );
}

interface DemoPanelParams {
  anchorText?: string;
  selectedText?: string;
}

function readDemoPanelParams(params: unknown): DemoPanelParams {
  if (typeof params !== "object" || params === null) return {};
  const record = params as Record<string, unknown>;
  return {
    anchorText:
      typeof record.anchorText === "string" ? record.anchorText : undefined,
    selectedText:
      typeof record.selectedText === "string" ? record.selectedText : undefined,
  };
}

function MessageAnchoredPanel({
  threadId,
  params,
}: {
  threadId: string;
  params: unknown;
}) {
  const { anchorText, selectedText } = readDemoPanelParams(params);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {anchorText ? (
        <div className="shrink-0 border-b p-2 text-xs text-muted-foreground">
          Anchored on: {selectedText ?? anchorText}
        </div>
      ) : null}
      <ThreadChat
        threadId={threadId}
        variant="compact"
        className="min-h-0 flex-1"
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "thread-chat-demo",
    title: "ThreadChat demo",
    icon: "MessageSquarePlus",
    path: "thread-chat",
    component: ThreadChatDemoPanel,
  });
  app.slots.threadPanelAction({
    id: "demo-panel",
    title: "ThreadChat demo panel",
    icon: "MessageSquarePlus",
    component: MessageAnchoredPanel,
  });
  app.slots.messageAction({
    id: "open-in-demo-panel",
    title: "Open in demo panel",
    icon: "MessageSquarePlus",
    run(context) {
      const opened = context.openPanel({
        actionId: "demo-panel",
        title: "Demo panel",
        params: {
          anchorText: context.message.text.slice(0, 200),
          ...(context.selectedText !== undefined
            ? { selectedText: context.selectedText.slice(0, 200) }
            : {}),
        },
      });
      if (!opened) {
        console.warn(
          "thread-chat-demo: this surface has no thread side panel to open",
        );
      }
    },
  });
});
