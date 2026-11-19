import { useCallback, useMemo, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useSidebarThreads as useSidebarThreads,
  ThreadChat,
  ThreadTitle,
  useBbNavigate,
  useSdk,
  type ExperimentalPageProps,
  type NewThreadComposerControl,
  type NewThreadRequest,
  type PluginSidebarThread,
  type ExperimentalThreadChatControl,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { groupConversations, listConversations } from "./conversations";

const NEW_CHAT_HIDDEN_CONTROLS: readonly NewThreadComposerControl[] = [
  "project",
  "environment",
  "permissionMode",
];
const THREAD_HIDDEN_CONTROLS: readonly ExperimentalThreadChatControl[] = [
  "environment",
  "permissionMode",
];

interface ConversationListProps {
  activeThreadId: string | null;
  isOpen: boolean;
  onNavigate: () => void;
}

function ConversationRow({
  conversation,
  isActive,
  onNavigate,
}: {
  conversation: PluginSidebarThread;
  isActive: boolean;
  onNavigate: () => void;
}) {
  return (
    <li>
      <a
        href={conversation.href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        data-chat-conversation={conversation.id}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground/90 transition-colors hover:bg-state-hover",
          isActive && "bg-state-active text-foreground",
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <ThreadTitle threadId={conversation.id} />
        </span>
        <ThreadStatusGlyph indicator={conversation.indicator} />
      </a>
    </li>
  );
}

function ConversationList({
  activeThreadId,
  isOpen,
  onNavigate,
}: ConversationListProps) {
  const { threads, status } = useSidebarThreads();
  const navigate = useBbNavigate();
  const [query, setQuery] = useState("");
  const [openedAt] = useState(Date.now);
  const groups = useMemo(
    () => groupConversations(listConversations(threads, query), openedAt),
    [threads, query, openedAt],
  );
  const startNewChat = () => {
    onNavigate();
    navigate.toCompose({ focusPrompt: true });
  };

  return (
    <aside
      data-chat-conversation-list=""
      className={cn(
        "flex w-72 shrink-0 flex-col border-r border-border bg-sidebar",
        "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:w-[85%] max-md:shadow-xl",
        !isOpen && "max-md:hidden",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <span className="px-1 text-base font-semibold">Chat</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="New chat"
          onClick={startNewChat}
        >
          <Icon name="MessageCirclePlus" />
        </Button>
      </div>
      <div className="relative px-3 pb-2">
        <Icon
          name="Search"
          className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          className="pl-8"
        />
      </div>
      <nav
        aria-label="Chats"
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
      >
        {status === "loading" && groups.length === 0 ? null : groups.length ===
          0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {query.trim().length > 0 ? "No chats match." : "No chats yet."}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label} className="pt-3 first:pt-1">
              <h2 className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                {group.label}
              </h2>
              <ul className="flex flex-col gap-0.5">
                {group.conversations.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    isActive={conversation.id === activeThreadId}
                    onNavigate={onNavigate}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>
      <div className="border-t border-border p-2">
        <a
          href="/settings"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
        >
          <Icon name="Settings" className="size-4" />
          Settings
        </a>
      </div>
    </aside>
  );
}

function NewChat() {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const submit = useCallback(
    async (request: NewThreadRequest) => {
      const thread = await sdk.threads.spawn(request);
      navigate.toThread(thread.id);
    },
    [navigate, sdk],
  );
  return (
    <div
      data-chat-home=""
      className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-[12vh]"
    >
      <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight">
        What can I help with?
      </h1>
      <div className="w-full max-w-3xl">
        <NewThreadComposer
          layout="document"
          placeholder="Ask anything"
          draftKey="chat-home"
          focusRequest={1}
          hiddenControls={NEW_CHAT_HIDDEN_CONTROLS}
          onSubmit={submit}
        />
      </div>
    </div>
  );
}

export function ChatPage({ location }: ExperimentalPageProps) {
  const [isListOpen, setIsListOpen] = useState(false);
  const closeList = useCallback(() => setIsListOpen(false), []);
  const activeThreadId = location.kind === "thread" ? location.threadId : null;
  return (
    <div
      data-chat-page={location.kind}
      className="relative flex h-full min-h-0 w-full bg-background"
    >
      <ConversationList
        activeThreadId={activeThreadId}
        isOpen={isListOpen}
        onNavigate={closeList}
      />
      {isListOpen ? (
        <button
          type="button"
          aria-label="Close chats"
          className="absolute inset-0 z-20 bg-surface-scrim md:hidden"
          onClick={closeList}
        />
      ) : null}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 px-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Show chats"
            className="md:hidden"
            onClick={() => setIsListOpen(true)}
          >
            <Icon name="PanelLeft" />
          </Button>
          {activeThreadId === null ? null : (
            <span className="min-w-0 truncate text-sm font-medium">
              <ThreadTitle threadId={activeThreadId} />
            </span>
          )}
        </header>
        {location.kind === "thread" ? (
          <ThreadChat
            threadId={location.threadId}
            variant="full"
            experimental_hiddenControls={THREAD_HIDDEN_CONTROLS}
            className="min-h-0 flex-1"
          />
        ) : (
          <NewChat />
        )}
      </main>
    </div>
  );
}
