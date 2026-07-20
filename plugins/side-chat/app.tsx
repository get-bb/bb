// bb-plugin-side-chat frontend — the plugin-owned side chat surface.
//
// "Reply in side chat" (message action bar + selection menu) asks the backend
// for an idle hidden fork, then opens a thread panel tab rendering the fork
// with the host-owned ThreadChat: a "Replying to" header above the
// conversation, a per-message "Send to main thread" action on assistant
// messages, and an "Open as full thread" promotion affordance.
import { useCallback, useState } from "react";
import { toast } from "sonner";
import Markdown from "react-markdown";
import { Icon } from "@bb/shared-ui/icon";
import {
  definePluginApp,
  ThreadChat,
  useBbNavigate,
  useRpc,
  type PluginMessageActionContext,
  type PluginThreadPanelActionContext,
  type PluginThreadPanelProps,
  type ThreadChatMessageAction,
} from "@bb/plugin-sdk/app";
import type { sideChatRpcContract } from "./server.js";

const PLUGIN_ID = "side-chat";
export const PANEL_ACTION_ID = "side-chat";

const PANEL_TAB_TITLE_MAX_LENGTH = 32;

/** Panel tab title: first line of the anchor, truncated; "Side chat" fallback. */
export function panelTabTitle(anchorText: string): string {
  const firstLine = anchorText.trim().split(/\r\n|\r|\n/u, 1)[0] ?? "";
  if (firstLine.length === 0) {
    return "Side chat";
  }
  if (firstLine.length <= PANEL_TAB_TITLE_MAX_LENGTH) {
    return firstLine;
  }
  return `${firstLine.slice(0, PANEL_TAB_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

// A type alias (not an interface) so it is assignable to the JsonValue
// `params` the host persists with the tab.
export type SideChatPanelParams = {
  threadId: string;
  sourceThreadId: string;
  sourceMessageText: string;
  sourceSeqEnd: number | null;
};

/** Narrow the persisted (untrusted, JSON-round-tripped) panel params. */
export function parsePanelParams(value: unknown): SideChatPanelParams | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.threadId !== "string" ||
    record.threadId.length === 0 ||
    typeof record.sourceThreadId !== "string" ||
    record.sourceThreadId.length === 0
  ) {
    return null;
  }
  return {
    threadId: record.threadId,
    sourceThreadId: record.sourceThreadId,
    sourceMessageText:
      typeof record.sourceMessageText === "string"
        ? record.sourceMessageText
        : "",
    sourceSeqEnd:
      typeof record.sourceSeqEnd === "number" ? record.sourceSeqEnd : null,
  };
}

/**
 * Direct call to this plugin's backend rpc — the message/panel action `run`
 * callbacks are host chrome (not components), so the `useRpc` hook is
 * unavailable there. Same route, envelope, and "local" auth the hook uses.
 */
async function callBackendRpc(method: string, input: unknown): Promise<unknown> {
  const response = await fetch(
    `/api/v1/plugins/${PLUGIN_ID}/rpc/${encodeURIComponent(method)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input ?? null),
    },
  );
  const body = (await response.json().catch(() => null)) as {
    ok?: unknown;
    result?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || body?.ok !== true) {
    const structuredMessage =
      typeof body?.error === "object" &&
      body.error !== null &&
      typeof (body.error as { message?: unknown }).message === "string"
        ? String((body.error as { message: string }).message)
        : null;
    throw new Error(
      structuredMessage ?? `rpc "${method}" failed (HTTP ${response.status})`,
    );
  }
  return body.result;
}

function createdThreadId(result: unknown): string {
  if (
    typeof result === "object" &&
    result !== null &&
    typeof (result as { threadId?: unknown }).threadId === "string"
  ) {
    return (result as { threadId: string }).threadId;
  }
  throw new Error("Plugin returned an unexpected createSideChat response.");
}

interface OpenSideChatArgs {
  sourceThreadId: string;
  anchorText: string;
  sourceSeqEnd: number | null;
  openPanel(options: { title: string; params: SideChatPanelParams }): unknown;
}

/**
 * Single-flight guard: launcher/message-action activations are not debounced
 * by the host, so a double click before the first createSideChat resolves
 * would mint two hidden forks. Equivalent opens (same source/anchor/seq)
 * share the in-flight promise; the map entry clears on settle so a later
 * deliberate re-open still works.
 */
const inFlightOpens = new Map<string, Promise<void>>();

function openKey({
  sourceThreadId,
  anchorText,
  sourceSeqEnd,
}: Pick<
  OpenSideChatArgs,
  "sourceThreadId" | "anchorText" | "sourceSeqEnd"
>): string {
  return `${sourceThreadId}|${sourceSeqEnd ?? "tip"}|${anchorText}`;
}

/** Create the idle hidden fork, then open the panel tab pointing at it. */
function openSideChat(args: OpenSideChatArgs): Promise<void> {
  const key = openKey(args);
  const pending = inFlightOpens.get(key);
  if (pending !== undefined) {
    return pending;
  }
  const run = createAndOpenSideChat(args);
  inFlightOpens.set(key, run);
  run.then(
    () => inFlightOpens.delete(key),
    () => inFlightOpens.delete(key),
  );
  return run;
}

async function createAndOpenSideChat({
  sourceThreadId,
  anchorText,
  sourceSeqEnd,
  openPanel,
}: OpenSideChatArgs): Promise<void> {
  let threadId: string;
  try {
    threadId = createdThreadId(
      await callBackendRpc("createSideChat", {
        sourceThreadId,
        ...(sourceSeqEnd !== null ? { sourceSeqEnd } : {}),
        anchorText,
      }),
    );
  } catch (error) {
    toast.error(
      `Failed to start side chat: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }
  openPanel({
    title: panelTabTitle(anchorText),
    params: {
      threadId,
      sourceThreadId,
      sourceMessageText: anchorText,
      sourceSeqEnd,
    },
  });
}

function ReplyingTo({ anchorText }: { anchorText: string }) {
  const trimmed = anchorText.trim();
  if (trimmed.length === 0) {
    return null;
  }
  // Mirrors the legacy side-chat header: a "Replying to" label above a
  // recessed bubble rendering the anchor as markdown.
  return (
    <div className="mx-1 mb-2 flex flex-col items-start gap-1">
      <span className="text-xs leading-none text-muted-foreground">
        <Icon
          name="CornerDownRight"
          className="mr-1 inline-block size-3 align-middle"
        />
        Replying to
      </span>
      <div className="max-w-full rounded-md bg-surface-recessed p-1.5 text-xs leading-5 text-foreground">
        <div className="max-h-20 overflow-hidden break-words [&_blockquote]:my-1 [&_h1]:mb-1 [&_h1]:mt-0 [&_h1]:text-sm [&_h2]:mb-1 [&_h2]:mt-0 [&_h2]:text-sm [&_h3]:mb-1 [&_h3]:mt-0 [&_h3]:text-xs [&_li]:mb-0 [&_ol]:mb-1 [&_p]:mb-1 [&_ul]:mb-1">
          <Markdown>{trimmed}</Markdown>
        </div>
      </div>
    </div>
  );
}

function SideChatPanel({ params }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof sideChatRpcContract>();
  const navigate = useBbNavigate();
  const [isPromoting, setIsPromoting] = useState(false);
  const parsed = parsePanelParams(params);
  const sideChatThreadId = parsed?.threadId ?? null;
  const sourceThreadId = parsed?.sourceThreadId ?? null;

  const sendToMain = useCallback(
    async (message: { text: string; threadId: string }) => {
      if (sourceThreadId === null || sideChatThreadId === null) return;
      try {
        await rpc.call("sendToMain", {
          sourceThreadId,
          senderThreadId: sideChatThreadId,
          text: message.text,
        });
        toast.success("Sent to main thread");
      } catch (error) {
        toast.error(
          `Failed to send to main thread: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [rpc, sideChatThreadId, sourceThreadId],
  );

  const openAsFullThread = useCallback(async () => {
    if (sideChatThreadId === null) return;
    setIsPromoting(true);
    try {
      await rpc.call("openAsFullThread", { threadId: sideChatThreadId });
      navigate.toThread(sideChatThreadId);
    } catch (error) {
      toast.error(
        `Failed to open as full thread: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setIsPromoting(false);
    }
  }, [navigate, rpc, sideChatThreadId]);

  if (parsed === null) {
    return (
      <div className="p-3 text-sm text-muted-foreground" role="alert">
        This side chat tab is missing its thread reference.
      </div>
    );
  }

  const messageActions: ThreadChatMessageAction[] = [
    {
      id: "send-to-main",
      title: "Send to main thread",
      icon: "ArrowTurnBackward",
      roles: ["assistant"],
      run: (message) => sendToMain(message),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end border-b border-border px-2 py-1">
        <button
          type="button"
          className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-surface-recessed hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          disabled={isPromoting}
          onClick={() => {
            void openAsFullThread();
          }}
        >
          <Icon name="ExternalLink" aria-hidden className="size-3" />
          Open as full thread
        </button>
      </div>
      <ThreadChat
        threadId={parsed.threadId}
        variant="compact"
        layout="contained"
        className="min-h-0 flex-1"
        leadingContent={<ReplyingTo anchorText={parsed.sourceMessageText} />}
        messageActions={messageActions}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.messageAction({
    id: "reply-in-side-chat",
    title: "Reply in side chat",
    icon: "SideChat",
    async run(context: PluginMessageActionContext) {
      const anchorText = context.selectedText ?? context.message.text;
      await openSideChat({
        sourceThreadId: context.threadId,
        anchorText,
        sourceSeqEnd: context.message.sourceSeqEnd,
        openPanel: (options) =>
          context.openPanel({ actionId: PANEL_ACTION_ID, ...options }),
      });
    },
  });
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: "Start side chat",
    icon: "SideChat",
    component: SideChatPanel,
    // Launcher activation forks from the thread tip: no anchor, no seed.
    async run(context: PluginThreadPanelActionContext) {
      await openSideChat({
        sourceThreadId: context.threadId,
        anchorText: "",
        sourceSeqEnd: null,
        openPanel: (options) => context.openPanel(options),
      });
    },
  });
});
