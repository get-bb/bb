import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  experimental_Icon as Icon,
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  experimental_useSidebarThreads,
  useRealtime,
  useRpc,
  type PluginRpcResult,
  type PluginSidebarThread,
  type PluginSidebarThreadIndicator,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_ROW_ACTION_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Item } from "../app-logic.js";
import type { PullTone } from "../pull-status.js";
import type { githubRpcContract } from "../server.js";

export type { Item };
export type IssueDetail = PluginRpcResult<
  (typeof githubRpcContract)["getIssue"]
>["issue"];
export type PullDetail = PluginRpcResult<
  (typeof githubRpcContract)["getPull"]
>["pull"];
export type PullCheck = PullDetail["checks"][number];
export type ReviewThread = PullDetail["reviewThreads"][number];
export type PullFile = PullDetail["files"][number];
export type Status = PluginRpcResult<(typeof githubRpcContract)["status"]>;
export type RepoInfo = Status["repos"][number];
export type LinksMap = PluginRpcResult<
  (typeof githubRpcContract)["listLinks"]
>["links"];
export type RepoSettings = PluginRpcResult<
  (typeof githubRpcContract)["repoSettings"]
>["repos"][string];
export type MergeMethod = RepoSettings["defaultMergeMethod"];

export const PANEL_PATH = "github";

export const TEXT_BUTTON_CLASS = "h-7 px-2 text-xs max-md:pointer-coarse:h-10";

export function itemKey(item: { repo: string; number: number }): string {
  return `${item.repo}#${item.number}`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function compactAge(iso: string | number, now = Date.now()): string {
  const then = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(1, Math.floor((now - then) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 60) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export function relativeTime(iso: string | number, now = Date.now()): string {
  const then = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (now - then) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="flex h-6 items-center gap-1.5 text-xs font-medium text-subtle-foreground">
      {children}
    </h3>
  );
}

export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(
      "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='combobox']",
    ) !== null
  );
}

export function useReturnFocus(
  open: boolean,
  fallback?: () => HTMLElement | null,
): (event: Event) => void {
  const [opened, setOpened] = useState(open);
  const [returnTo, setReturnTo] = useState<HTMLElement | null>(null);
  if (opened !== open) {
    setOpened(open);
    if (open) {
      setReturnTo(
        document.activeElement instanceof HTMLElement &&
          document.activeElement !== document.body
          ? document.activeElement
          : null,
      );
    }
  }
  return useCallback(
    (event: Event) => {
      const target =
        returnTo !== null && returnTo.isConnected
          ? returnTo
          : (fallback?.() ?? null);
      if (target === null || !target.isConnected) return;
      event.preventDefault();
      target.focus();
    },
    [fallback, returnTo],
  );
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

type GithubRpc = ReturnType<typeof useRpc<typeof githubRpcContract>>;

interface ResourceState<T> {
  value: T | null;
  error: string | null;
}

interface SharedResource<T> {
  subscribe: (listener: () => void) => () => void;
  snapshot: () => ResourceState<T>;
  attach: (rpc: GithubRpc) => void;
  ensure: () => void;
  refetch: () => void;
}

function sharedResource<T>(
  fetch: (rpc: GithubRpc) => Promise<T>,
): SharedResource<T> {
  const empty: ResourceState<T> = { value: null, error: null };
  const listeners = new Set<() => void>();
  let state = empty;
  let client: GithubRpc | null = null;
  let generation = 0;
  let running = false;
  let again = false;
  let scheduled = false;

  const settle = (from: number, next: ResourceState<T>) => {
    if (from !== generation) return;
    running = false;
    state = next;
    for (const listener of listeners) listener();
    if (again) {
      again = false;
      refetch();
    }
  };
  const run = () => {
    if (running) {
      again = true;
      return;
    }
    if (client === null) return;
    running = true;
    const from = generation;
    fetch(client).then(
      (value) => settle(from, { value, error: null }),
      (error: unknown) =>
        settle(from, { value: state.value, error: errorText(error) }),
    );
  };
  const refetch = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      run();
    });
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        queueMicrotask(() => {
          if (listeners.size > 0) return;
          generation += 1;
          state = empty;
          client = null;
          running = false;
          again = false;
        });
      };
    },
    snapshot: () => state,
    attach(rpc) {
      client = rpc;
    },
    ensure() {
      if (state === empty && !running) refetch();
    },
    refetch,
  };
}

function useShared<T>(
  resource: SharedResource<T>,
  channel: string,
): ResourceState<T> {
  const rpc = useRpc<typeof githubRpcContract>();
  const state = useSyncExternalStore(
    resource.subscribe,
    resource.snapshot,
    resource.snapshot,
  );
  useEffect(() => {
    resource.attach(rpc);
    resource.ensure();
  }, [resource, rpc]);
  useRealtime(channel, resource.refetch);
  return state;
}

const pullItems = sharedResource((rpc) =>
  rpc.call("listItems", { kind: "pr" }).then((result) => result.items),
);
const issueItems = sharedResource((rpc) =>
  rpc.call("listItems", { kind: "issue" }).then((result) => result.items),
);
const links = sharedResource((rpc) =>
  rpc.call("listLinks").then((result) => result.links),
);
const repoSettings = sharedResource((rpc) =>
  rpc.call("repoSettings").then((result) => result.repos),
);
const status = sharedResource((rpc) => rpc.call("status"));
const viewer = sharedResource((rpc) =>
  rpc.call("viewer").then((result) => result.login),
);

export function useItems(kind: "issue" | "pr"): {
  items: Item[] | null;
  error: string | null;
  refetch: () => void;
} {
  const resource = kind === "pr" ? pullItems : issueItems;
  const { value, error } = useShared(resource, "data-changed");
  return { items: value, error, refetch: resource.refetch };
}

const NO_LINKS: LinksMap = {};

export function useLinks(): LinksMap {
  return useShared(links, "links-changed").value ?? NO_LINKS;
}

export function useRepoSettings(): Record<string, RepoSettings> | null {
  return useShared(repoSettings, "data-changed").value;
}

export function useStatus(): Status | null {
  return useShared(status, "data-changed").value;
}

export function useViewer(): string | null {
  return useShared(viewer, "data-changed").value;
}

export function useViewerState(): {
  login: string | null;
  error: string | null;
  retry: () => void;
} {
  const state = useShared(viewer, "data-changed");
  return {
    login: state.value,
    error: state.value === null ? state.error : null,
    retry: viewer.refetch,
  };
}

let syncing = false;
const syncListeners = new Set<() => void>();

function setSyncing(next: boolean): void {
  syncing = next;
  for (const listener of syncListeners) listener();
}

function subscribeSync(listener: () => void): () => void {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

export function useSync(): { syncing: boolean; refresh: () => void } {
  const rpc = useRpc<typeof githubRpcContract>();
  const busy = useSyncExternalStore(
    subscribeSync,
    () => syncing,
    () => syncing,
  );
  const refresh = useCallback(() => {
    if (syncing) return;
    setSyncing(true);
    rpc.call("refresh").then(
      () => {
        setSyncing(false);
        toast.success("Synced with GitHub", { id: "github-sync" });
      },
      (error: unknown) => {
        setSyncing(false);
        toast.error("Couldn't sync with GitHub", {
          id: "github-sync",
          description: errorText(error),
        });
      },
    );
  }, [rpc]);
  return { syncing: busy, refresh };
}

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

export function useStored<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => parse(readStored(key)));
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    setValue(parse(readStored(key)));
  }
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writeStored(key, serialize(next));
    },
    [key, serialize],
  );
  return [value, update];
}

export interface AgentInfo {
  threadId: string;
  title: string;
  state: "running" | "waiting" | "idle";
  indicator: PluginSidebarThreadIndicator;
  startedAt: number;
  updatedAt: number;
}

const RUNNING_STATUSES = new Set(["pending", "starting", "active", "stopping"]);

function agentStateOf(thread: PluginSidebarThread): AgentInfo["state"] {
  if (thread.hasPendingInteraction) return "waiting";
  if (RUNNING_STATUSES.has(thread.status)) return "running";
  return "idle";
}

export function useAgents(): ReadonlyMap<string, AgentInfo> {
  const links = useLinks();
  const { threads } = experimental_useSidebarThreads();
  return useMemo(() => {
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const agents = new Map<string, AgentInfo>();
    for (const [key, entries] of Object.entries(links)) {
      const newest = [...entries].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      for (const link of newest) {
        const thread = byId.get(link.threadId);
        if (thread === undefined || thread.isArchived) continue;
        agents.set(key, {
          threadId: thread.id,
          title: thread.displayTitle,
          state: agentStateOf(thread),
          indicator: thread.indicator,
          startedAt: thread.createdAt,
          updatedAt: thread.updatedAt,
        });
        break;
      }
    }
    return agents;
  }, [links, threads]);
}

export function useBranchEnvironment(): (
  branch: string,
  projectId: string | null,
) => string | null {
  const { threads } = experimental_useSidebarThreads();
  return useCallback(
    (branch, projectId) => {
      if (projectId === null) return null;
      for (const thread of threads) {
        if (thread.isArchived || thread.projectId !== projectId) continue;
        const environment = thread.environment;
        if (environment?.id != null && environment.branchName === branch) {
          return environment.id;
        }
      }
      return null;
    },
    [threads],
  );
}

export function useProjectHost(): (projectId: string | null) => string | null {
  const state = experimental_useSidebarThreads();
  return useCallback(
    (projectId) => {
      const sorted = [...state.threads].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );
      const match = sorted.find(
        (thread) =>
          thread.host !== null &&
          (projectId === null || thread.projectId === projectId),
      );
      return match?.host?.id ?? state.experimental_hosts?.[0]?.id ?? null;
    },
    [state],
  );
}

export function Avatar({
  login,
  size = "size-5",
}: {
  login: string;
  size?: string;
}) {
  return (
    <img
      src={`https://github.com/${encodeURIComponent(login)}.png?size=64`}
      alt=""
      title={login}
      loading="lazy"
      className={`${size} shrink-0 rounded-full bg-muted`}
    />
  );
}

export function PullAuthor({
  login,
  size = "size-4",
}: {
  login: string;
  size?: string;
}) {
  if (login.startsWith("app/")) {
    return (
      <span title={login.slice(4)} className={`flex ${size} items-center`}>
        <Icon name="Bot" className={`${size} text-muted-foreground`} />
      </span>
    );
  }
  return <Avatar login={login} size={size} />;
}

export function authorName(login: string): string {
  return login.startsWith("app/") ? login.slice(4) : login;
}

export const PULL_TONE_CLASS: Record<PullTone, string> = {
  action: "text-destructive",
  ready: "text-success",
  merged: "text-pr-merged",
  you: "text-foreground",
  waiting: "text-muted-foreground",
  closed: "text-destructive",
  working: "text-muted-foreground animate-spin motion-reduce:animate-none",
};

export function stateDotClass(kind: "issue" | "pr", state: string): string {
  if (state === "OPEN") return "bg-success";
  if (state === "DRAFT") return "bg-muted-foreground";
  if (kind === "pr" && state === "CLOSED") return "bg-destructive";
  return "bg-pr-merged";
}

export function StateDot({
  kind,
  state,
}: {
  kind: "issue" | "pr";
  state: string;
}) {
  return (
    <span
      className={`size-2 shrink-0 rounded-full ${stateDotClass(kind, state)}`}
    />
  );
}

function TipContent({
  label,
  keys,
}: {
  label: string;
  keys: readonly string[] | undefined;
}) {
  return (
    <TooltipContent className="flex items-center gap-2">
      {label}
      {keys === undefined ? null : (
        <span className="flex gap-0.5 pointer-coarse:hidden">
          {keys.map((key) => (
            <kbd
              key={key}
              className="rounded-sm bg-background/20 px-1 font-sans text-xs"
            >
              {key}
            </kbd>
          ))}
        </span>
      )}
    </TooltipContent>
  );
}

export function TriggerTip({
  label,
  keys,
  children,
}: {
  label: string;
  keys?: readonly string[];
  children: React.ReactElement;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild onFocus={(event) => event.preventDefault()}>
          {children}
        </TooltipTrigger>
        <TipContent label={label} keys={keys} />
      </Tooltip>
    </TooltipProvider>
  );
}

export function TipButton({
  label,
  keys,
  icon,
  onClick,
  busy = false,
  tone,
  tabIndex,
}: {
  label: string;
  keys?: readonly string[];
  icon: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  busy?: boolean;
  tone?: string;
  tabIndex?: number;
}) {
  return (
    <TriggerTip label={label} keys={keys}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={`${COARSE_POINTER_ROW_ACTION_SIZE_CLASS} text-muted-foreground hover:text-foreground`}
        aria-label={label}
        aria-busy={busy ? true : undefined}
        disabled={busy}
        tabIndex={tabIndex}
        onClick={onClick}
      >
        <Icon
          name={busy ? "Spinner" : icon}
          className={`size-4 ${busy ? "animate-spin motion-reduce:animate-none" : (tone ?? "")}`}
        />
      </Button>
    </TriggerTip>
  );
}

export function AgentGlyph({ agent }: { agent: AgentInfo }) {
  if (agent.state === "running" && agent.indicator === "none") {
    return (
      <Icon
        name="Zap"
        aria-label="Agent working"
        className="size-3.5 shrink-0 animate-shine-icon text-muted-foreground"
      />
    );
  }
  return <ThreadStatusGlyph indicator={agent.indicator} size="compact" />;
}

export function SpinnerIcon({ className = "size-4" }: { className?: string }) {
  return (
    <Icon
      name="Spinner"
      className={`${className} animate-spin motion-reduce:animate-none`}
    />
  );
}
