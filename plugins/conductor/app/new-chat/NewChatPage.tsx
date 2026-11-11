import { useCallback, useMemo, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreads as useSidebarThreads,
  ThreadTitle,
  useBbNavigate,
  useComposers,
  useSdk,
  type NewThreadRequest,
  type PluginComposerApi,
  type PluginNavPanelProps,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { useLastActiveThreads } from "../sidebar/prefs.js";
import { TabStrip } from "../tabs/WorkspaceTabs.js";
import { findWorkspace } from "../workspace.js";
import { useMarkNewChatEnvironment } from "./active.js";
import { draftKeyFor, environmentIdFromSubPath } from "./route.js";

function findComposer(
  composers: readonly PluginComposerApi[],
  draftKey: string,
): PluginComposerApi | null {
  const fresh = composers.filter(
    (composer) => composer.scope.kind === "new-thread",
  );
  return (
    fresh.find((composer) => composer.key.includes(draftKey)) ??
    fresh.at(-1) ??
    null
  );
}

function TranscriptChip({
  chat,
  onAdd,
}: {
  chat: PluginSidebarThread;
  onAdd(chat: PluginSidebarThread): void;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-7 max-w-64 min-w-0 items-center gap-1.5 rounded-md border border-border-hairline px-2 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground"
      onClick={() => onAdd(chat)}
    >
      <Icon name="MessageSquare" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        <ThreadTitle threadId={chat.id} />
      </span>
    </button>
  );
}

function TranscriptChips({
  chats,
  draftKey,
}: {
  chats: readonly PluginSidebarThread[];
  draftKey: string;
}) {
  const composers = useComposers();
  const addTranscript = (chat: PluginSidebarThread) => {
    const composer = findComposer(composers, draftKey);
    if (composer === null) return;
    composer.insert([
      {
        from: 0,
        to: 0,
        kind: "thread",
        threadId: chat.id,
        projectId: chat.projectId,
        label: chat.displayTitle,
      },
      " ",
    ]);
    composer.focus();
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {chats.map((chat) => (
        <TranscriptChip key={chat.id} chat={chat} onAdd={addTranscript} />
      ))}
    </div>
  );
}

export function NewChatPage({ subPath }: PluginNavPanelProps) {
  const environmentId = environmentIdFromSubPath(subPath);
  useMarkNewChatEnvironment(environmentId);
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const lastActive = useLastActiveThreads();
  const { threads, projects } = useSidebarThreads();
  const [focusRequest, setFocusRequest] = useState(1);
  const defaultEnvironment = useMemo(
    () =>
      environmentId === null
        ? undefined
        : ({ type: "reuse", environmentId } as const),
    [environmentId],
  );
  const submit = useCallback(
    async (request: NewThreadRequest) => {
      const thread = await sdk.threads.spawn(request);
      navigate.toThread(thread.id);
    },
    [navigate, sdk],
  );
  const workspace = useMemo(
    () =>
      environmentId === null
        ? null
        : findWorkspace(threads, projects, environmentId, null),
    [environmentId, projects, threads],
  );

  if (environmentId === null || workspace === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This workspace has no open chats.
      </div>
    );
  }

  const closeUntitled = () => {
    const remembered = lastActive[`env:${environmentId}`];
    const target =
      workspace.chats.find((chat) => chat.id === remembered) ??
      workspace.chats.at(-1);
    if (target !== undefined) navigate.toThread(target.id);
  };

  return (
    <div
      data-conductor-new-chat={environmentId}
      className="flex h-full min-h-0 flex-col"
    >
      <TabStrip
        chats={workspace.chats}
        activeThreadId={null}
        untitled={true}
        onNewChat={() => setFocusRequest((value) => value + 1)}
        onCloseUntitled={closeUntitled}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 overflow-y-auto px-6 py-5 text-sm text-muted-foreground">
          <p>
            New chat in{" "}
            <code className="font-mono text-foreground">
              /{workspace.label}
            </code>
            .
          </p>
          {workspace.chats.length === 0 ? null : (
            <div className="flex flex-col gap-2">
              <p>Add chat transcripts:</p>
              <TranscriptChips
                chats={workspace.chats}
                draftKey={draftKeyFor(environmentId)}
              />
            </div>
          )}
        </div>
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
          <NewThreadComposer
            key={environmentId}
            layout="document"
            draftKey={draftKeyFor(environmentId)}
            defaultProjectId={workspace.projectId}
            defaultEnvironment={defaultEnvironment}
            focusRequest={focusRequest}
            placeholder="Ask to make changes, @mention files, run /commands"
            onSubmit={submit}
          />
        </div>
      </div>
    </div>
  );
}
