// bb-plugin-side-chat frontend — the plugin-owned side chat surface.
//
// "Reply in side chat" (message action bar + selection menu) asks the backend
// for an idle hidden fork, then opens a thread panel tab rendering the fork
// with the host-owned ThreadChat: a "Replying to" header above the
// conversation, a per-message "Send to main thread" action on assistant
// messages.
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Icon } from "@bb/shared-ui/icon";
import {
  definePluginApp,
  Markdown,
  ThreadChat,
  useRpc,
  type PluginMessageActionContext,
  type PluginThreadPanelActionContext,
  type PluginThreadPanelProps,
  type ThreadChatMessageAction,
} from "@get-bb/plugin-sdk/app";
import type { sideChatRpcContract } from "./server.js";

const PLUGIN_ID = "side-chat";
export const PANEL_ACTION_ID = "side-chat";

/** Every side-chat tab is labeled like the legacy panel tab. */
const PANEL_TAB_TITLE = "Side chat";

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
async function callBackendRpc(
  method: string,
  input: unknown,
): Promise<unknown> {
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
  /**
   * Both call sites' `openPanel` narrowed to what this helper needs. Every
   * SDK `openPanel` reports whether the host accepted the open, so the two
   * action kinds share one signature here — this was `unknown` only to
   * bridge them before they agreed.
   *
   * Nothing reads the result: no surface renders a plugin `messageAction`
   * without a panel to open into, so there is no reachable decline to
   * handle. `PluginThreadChat` sets `includePluginMessageActions={false}`,
   * which is what keeps this action out of a side chat's own transcript.
   */
  openPanel(options: { title: string; params: SideChatPanelParams }): boolean;
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
    title: PANEL_TAB_TITLE,
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
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // Overflow is measured (not assumed from length) so the fade and the
  // expand affordance only appear when the clamp actually cuts content.
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (node !== null) {
      setOverflows(node.scrollHeight > node.clientHeight + 1);
    }
  }, []);
  if (trimmed.length === 0) {
    return null;
  }
  const clamped = !expanded;
  // Mirrors the legacy side-chat header: a "Replying to" label above a
  // recessed bubble rendering the anchor as markdown. Long anchors clamp
  // with a bottom fade instead of a hard mid-line cut; clicking the bubble
  // toggles the full quote.
  return (
    <div className="mx-1 mb-2 flex flex-col items-start gap-1">
      <span className="text-xs leading-none text-muted-foreground">
        <Icon
          name="CornerDownRight"
          className="mr-1 inline-block size-3 align-middle"
        />
        Replying to
      </span>
      <div
        className={`max-w-full rounded-md bg-surface-recessed p-1.5 text-xs leading-5 text-foreground ${
          overflows ? "cursor-pointer" : ""
        }`}
        role={overflows ? "button" : undefined}
        title={
          overflows ? (expanded ? "Collapse" : "Show full message") : undefined
        }
        onClick={overflows ? () => setExpanded((value) => !value) : undefined}
      >
        <div
          ref={measureRef}
          className={
            clamped
              ? "max-h-20 overflow-hidden break-words " +
                (overflows
                  ? "[mask-image:linear-gradient(to_bottom,black_calc(100%-1.25rem),transparent)]"
                  : "")
              : "break-words"
          }
        >
          <Markdown
            content={trimmed}
            className="text-xs leading-5 [&_blockquote]:my-1 [&_h1]:mb-1 [&_h1]:mt-0 [&_h1]:text-sm [&_h2]:mb-1 [&_h2]:mt-0 [&_h2]:text-sm [&_h3]:mb-1 [&_h3]:mt-0 [&_h3]:text-xs [&_li]:mb-0 [&_ol]:mb-1 [&_p]:mb-1 [&_ul]:mb-1"
          />
        </div>
      </div>
    </div>
  );
}

function SideChatPanel({ params }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof sideChatRpcContract>();
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
      <ThreadChat
        threadId={parsed.threadId}
        variant="compact"
        layout="contained"
        // The side chat is its own thread: a quick aside may deserve tighter
        // (or looser) permissions than the thread it forked from, so the
        // picker stays live here instead of mirroring the source thread.
        permissionPolicy="editable"
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
    // The embedded chat owns its layout; padded framing would float the
    // composer above the main thread's baseline.
    layout: "flush",
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
