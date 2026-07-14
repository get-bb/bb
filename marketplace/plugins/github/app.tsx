// bb-plugin-github — the frontend bundle.
//
// A GitHub panel: Issues / Pull Requests as a filterable table (state chips,
// "Assigned to me", text search), inline status + assignee editing, issue and
// pull-request detail views with a metadata sidebar (the PR view covers
// checks, reviews, inline review threads, and per-file diffs — VS Code's
// GitHub integration, shrunk to a panel). "Send agent" buttons everywhere an
// issue or PR shows up. Deep links use the URL hash
// (#/issues/<owner>/<repo>/<n>, #/pulls/<owner>/<repo>/<n>) since navPanel
// owns /plugins/github/github/* via subPath routing. A threadPanelAction opens the same PR view in a
// thread's right panel, auto-resolved to that thread's PR.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
  type PluginThreadPanelProps,
} from "@bb/plugin-sdk/app";
// Shimmed to the host's copy at build time (shared worker-pool context +
// shiki stays out of the plugin bundle) — diffs render with the same syntax
// highlighting as the app's own diff panel.
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown-lite";
import { PageBody } from "@/components/page-body";

interface Item {
  repo: string;
  number: number;
  kind: "issue" | "pr";
  title: string;
  state: string;
  author: string;
  labels: string[];
  assignees: string[];
  url: string;
  body: string;
  updatedAt: string;
}

interface IssueComment {
  author: string;
  body: string;
  createdAt: string;
}

interface IssueDetail extends Omit<Item, "kind"> {
  comments: IssueComment[];
}

interface PullCheck {
  name: string;
  status: "success" | "failure" | "pending" | "neutral";
  url: string;
}

interface PullReview {
  author: string;
  state: string;
  body: string;
  createdAt: string;
}

interface ReviewThread {
  path: string;
  line: number | null;
  diffHunk: string;
  comments: IssueComment[];
}

interface PullFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

interface PullDetail {
  repo: string;
  number: number;
  title: string;
  state: string; // OPEN | DRAFT | MERGED | CLOSED
  author: string;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  baseRefName: string;
  headRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  assignees: string[];
  reviewDecision: string;
  mergeStateStatus: string;
  reviewRequests: string[];
  checks: PullCheck[];
  comments: IssueComment[];
  reviews: PullReview[];
  reviewThreads: ReviewThread[];
  files: PullFile[];
}

interface RepoInfo {
  repo: string;
  projectId: string | null;
}

interface ThreadLink {
  kind: "issue" | "pr";
  repo: string;
  number: number;
  threadId: string;
  createdAt: string;
}

type LinksMap = Record<string, ThreadLink[]>;

function asItems(result: unknown): Item[] {
  const items = (result as { items?: unknown })?.items;
  return Array.isArray(items) ? (items as Item[]) : [];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Sub-routing — the navPanel owns /plugins/github/github/*, so sub-navigation
// lives in the route's subPath: "issues", "pulls", "new",
// "issues/<owner>/<repo>/<number>". Deep-linkable, and browser back/forward
// walks panel history.
// ---------------------------------------------------------------------------

const PANEL_PATH = "github";

type Route =
  | { view: "issues" }
  | { view: "pulls" }
  | { view: "new" }
  | { view: "issue"; repo: string; number: number }
  | { view: "pull"; repo: string; number: number };

function parseSubPath(subPath: string): Route {
  const parts = subPath.split("/").filter((p) => p.length > 0);
  if (parts[0] === "pulls" && parts.length === 4) {
    const number = Number(parts[3]);
    if (Number.isFinite(number)) {
      return { view: "pull", repo: `${parts[1]}/${parts[2]}`, number };
    }
  }
  if (parts[0] === "pulls") return { view: "pulls" };
  if (parts[0] === "new") return { view: "new" };
  if (parts[0] === "issues" && parts.length === 4) {
    const number = Number(parts[3]);
    if (Number.isFinite(number)) {
      return { view: "issue", repo: `${parts[1]}/${parts[2]}`, number };
    }
  }
  return { view: "issues" };
}

function routeToSubPath(route: Route): string {
  switch (route.view) {
    case "issues":
      return "issues";
    case "pulls":
      return "pulls";
    case "new":
      return "new";
    case "issue":
      return `issues/${route.repo}/${route.number}`;
    case "pull":
      return `pulls/${route.repo}/${route.number}`;
  }
}

function useSubPathRoute(subPath: string): [Route, (route: Route) => void] {
  const bbNavigate = useBbNavigate();
  const route = useMemo(() => parseSubPath(subPath), [subPath]);
  const navigate = useCallback(
    (next: Route) => {
      bbNavigate.toPluginPanel(PANEL_PATH, { subPath: routeToSubPath(next) });
    },
    [bbNavigate],
  );
  return [route, navigate];
}

// ---------------------------------------------------------------------------
// Data hooks.
// ---------------------------------------------------------------------------

// All cached items of a kind — filtering happens client-side in the filter
// bar's query engine, so keystrokes never round-trip to the server.
function useItems(kind: "issue" | "pr"): {
  items: Item[] | null;
  error: string | null;
} {
  const rpc = useRpc();
  const [state, setState] = useState<{ items: Item[] | null; error: string | null }>({
    items: null,
    error: null,
  });
  const refetch = useCallback(() => {
    rpc.call("listItems", { kind }).then(
      (result) => setState({ items: asItems(result), error: null }),
      (error: unknown) => setState({ items: null, error: errorText(error) }),
    );
  }, [rpc, kind]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("data-changed", refetch);
  return state;
}

function useLinks(): LinksMap {
  const rpc = useRpc();
  const [links, setLinks] = useState<LinksMap>({});
  const refetch = useCallback(() => {
    rpc.call("listLinks").then(
      (result) => {
        const map = (result as { links?: unknown })?.links;
        if (map !== null && typeof map === "object") setLinks(map as LinksMap);
      },
      () => {},
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("links-changed", refetch);
  return links;
}

function useSpawn(): {
  spawn: (method: "startWork" | "startReview", repo: string, number: number) => void;
  spawningKey: string | null;
} {
  const rpc = useRpc();
  const navigate = useBbNavigate();
  const [spawningKey, setSpawningKey] = useState<string | null>(null);
  const spawn = useCallback(
    (method: "startWork" | "startReview", repo: string, number: number) => {
      setSpawningKey(`${repo}#${number}`);
      rpc
        .call(method, { repo, number })
        .then((result) => {
          const threadId = (result as { threadId?: unknown })?.threadId;
          if (typeof threadId !== "string") throw new Error("malformed spawn result");
          navigate.toThread(threadId);
        })
        .catch((error: unknown) => toast.error(errorText(error)))
        .finally(() => setSpawningKey(null));
    },
    [rpc, navigate],
  );
  return { spawn, spawningKey };
}

// The gh viewer login, cached at module level — one fetch per page load.
let viewerLogin: string | null = null;

function useViewer(): string | null {
  const rpc = useRpc();
  const [login, setLogin] = useState<string | null>(viewerLogin);
  useEffect(() => {
    if (viewerLogin !== null) return;
    rpc.call("viewer").then(
      (result) => {
        const value = (result as { login?: unknown })?.login;
        if (typeof value === "string" && value.length > 0) {
          viewerLogin = value;
          setLogin(value);
        }
      },
      () => {},
    );
  }, [rpc]);
  return login;
}

// ---------------------------------------------------------------------------
// Shared bits.
// ---------------------------------------------------------------------------

/** GitHub avatar by login — github.com serves these without auth. */
function Avatar({
  login,
  size = "size-5",
  className,
}: {
  login: string;
  size?: string;
  className?: string;
}) {
  return (
    <img
      src={`https://github.com/${encodeURIComponent(login)}.png?size=64`}
      alt={login}
      title={login}
      loading="lazy"
      className={`${size} shrink-0 rounded-full bg-muted ${className ?? ""}`}
    />
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-50"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function stateDotClass(kind: "issue" | "pr", state: string): string {
  if (state === "OPEN") return "bg-green-500";
  if (kind === "pr" && state === "MERGED") return "bg-purple-500";
  if (kind === "pr") return "bg-red-500";
  return "bg-purple-500";
}

function StateDot({ kind, state }: { kind: "issue" | "pr"; state: string }) {
  return <span className={`size-2 shrink-0 rounded-full ${stateDotClass(kind, state)}`} />;
}

function StateBadge({ kind, state }: { kind: "issue" | "pr"; state: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <StateDot kind={kind} state={state} />
      {state.toLowerCase()}
    </Badge>
  );
}

function ThreadPills({ links }: { links: ThreadLink[] | undefined }) {
  const navigate = useBbNavigate();
  if (links === undefined || links.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {links.map((link, index) => (
        <Badge
          key={link.threadId}
          title={`Open BB thread ${link.threadId}`}
          onClick={(event) => {
            event.stopPropagation();
            navigate.toThread(link.threadId);
          }}
          variant="secondary"
          className="cursor-pointer whitespace-nowrap hover:bg-accent"
        >
          ⚡ agent{links.length > 1 ? ` ${index + 1}` : ""}
        </Badge>
      ))}
    </span>
  );
}

function LabelChips({ labels, className }: { labels: string[]; className?: string }) {
  if (labels.length === 0) return null;
  return (
    <span className={`items-center gap-1 ${className ?? "flex shrink-0"}`}>
      {labels.slice(0, 3).map((label) => (
        <Badge key={label} variant="secondary" className="font-normal text-muted-foreground">
          {label}
        </Badge>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Mutations (status, assignees, labels) with optimistic-friendly callbacks.
// ---------------------------------------------------------------------------

function useIssueMutations() {
  const rpc = useRpc();
  const setIssueState = useCallback(
    (repo: string, number: number, state: "open" | "closed") =>
      rpc
        .call("setIssueState", { repo, number, state })
        .then(() => toast.success(state === "closed" ? `#${number} closed` : `#${number} reopened`)),
    [rpc],
  );
  const setAssignees = useCallback(
    (repo: string, number: number, assignees: string[]) =>
      rpc.call("setAssignees", { repo, number, assignees }),
    [rpc],
  );
  const setLabels = useCallback(
    (repo: string, number: number, labels: string[]) =>
      rpc.call("setLabels", { repo, number, labels }),
    [rpc],
  );
  return { setIssueState, setAssignees, setLabels };
}

// ---------------------------------------------------------------------------
// Query engine — GitHub-style qualifiers parsed and matched client-side.
//   is:open · is:closed · is:merged · assignee:<login> · assignee:@me
//   author:<login> · label:<name> ("quoted" for spaces) · repo:<owner/name>
//   no:assignee · no:label · anything else matches title / number / repo
// ---------------------------------------------------------------------------

interface ParsedQuery {
  states: string[];
  assignees: string[];
  authors: string[];
  labels: string[];
  repos: string[];
  noAssignee: boolean;
  noLabel: boolean;
  text: string[];
}

function tokenizeQuery(query: string): string[] {
  return query.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

function unquote(value: string): string {
  return value.replace(/"/g, "");
}

const STATE_VALUES: Record<string, string> = {
  open: "OPEN",
  closed: "CLOSED",
  merged: "MERGED",
};

function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = {
    states: [],
    assignees: [],
    authors: [],
    labels: [],
    repos: [],
    noAssignee: false,
    noLabel: false,
    text: [],
  };
  for (const token of tokenizeQuery(query)) {
    const idx = token.indexOf(":");
    const key = idx > 0 ? token.slice(0, idx).toLowerCase() : "";
    const value = idx > 0 ? unquote(token.slice(idx + 1)) : "";
    // A dangling "key:" (still being typed) filters nothing.
    if (idx > 0 && value.length === 0) continue;
    if (key === "is" || key === "state") {
      parsed.states.push(STATE_VALUES[value.toLowerCase()] ?? value.toUpperCase());
    } else if (key === "assignee") {
      parsed.assignees.push(value.toLowerCase());
    } else if (key === "author") {
      parsed.authors.push(value.toLowerCase());
    } else if (key === "label") {
      parsed.labels.push(value.toLowerCase());
    } else if (key === "repo") {
      parsed.repos.push(value.toLowerCase());
    } else if (key === "no") {
      if (value.toLowerCase() === "assignee") parsed.noAssignee = true;
      if (value.toLowerCase() === "label") parsed.noLabel = true;
    } else {
      parsed.text.push(unquote(token).toLowerCase());
    }
  }
  return parsed;
}

function matchesQuery(item: Item, query: ParsedQuery, viewer: string | null): boolean {
  if (query.states.length > 0 && !query.states.includes(item.state)) return false;
  if (query.assignees.length > 0) {
    const wanted = query.assignees.map((login) =>
      login === "@me" ? (viewer?.toLowerCase() ?? "\u0000") : login,
    );
    if (!item.assignees.some((login) => wanted.includes(login.toLowerCase()))) return false;
  }
  if (query.authors.length > 0) {
    const author = item.author.toLowerCase();
    const wanted = query.authors.map((login) =>
      login === "@me" ? (viewer?.toLowerCase() ?? "\u0000") : login,
    );
    if (!wanted.includes(author)) return false;
  }
  if (query.labels.length > 0) {
    const labels = item.labels.map((label) => label.toLowerCase());
    if (!query.labels.some((label) => labels.includes(label))) return false;
  }
  if (query.repos.length > 0 && !query.repos.includes(item.repo.toLowerCase())) return false;
  if (query.noAssignee && item.assignees.length > 0) return false;
  if (query.noLabel && item.labels.length > 0) return false;
  if (query.text.length > 0) {
    const haystack = `${item.title} #${item.number} ${item.repo}`.toLowerCase();
    if (!query.text.every((term) => haystack.includes(term))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The filter bar: one input, GitHub-style typeahead over keys and values.
// ---------------------------------------------------------------------------

interface Suggestion {
  /** Replaces the token being typed. */
  insert: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
}

const QUALIFIER_KEYS: Array<{ key: string; hint: string }> = [
  { key: "is:", hint: "state — open, closed, merged" },
  { key: "assignee:", hint: "assigned user, or @me" },
  { key: "author:", hint: "opened by" },
  { key: "label:", hint: "has label" },
  { key: "repo:", hint: "in repository" },
  { key: "no:", hint: "missing — assignee, label" },
];

function quoteValue(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

function buildSuggestions(
  token: string,
  vocab: { users: string[]; labels: string[]; repos: string[] },
  kind: "issue" | "pr",
  viewer: string | null,
): Suggestion[] {
  const idx = token.indexOf(":");
  if (idx <= 0) {
    const prefix = token.toLowerCase();
    return QUALIFIER_KEYS.filter((entry) => entry.key.startsWith(prefix)).map((entry) => ({
      insert: entry.key,
      label: entry.key,
      hint: entry.hint,
    }));
  }
  const key = token.slice(0, idx).toLowerCase();
  const partial = unquote(token.slice(idx + 1)).toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(partial);
  if (key === "is" || key === "state") {
    const states = kind === "pr" ? ["open", "closed", "merged"] : ["open", "closed"];
    return states.filter(matches).map((state) => ({
      insert: `${key}:${state} `,
      label: state,
      icon: <StateDot kind={kind} state={STATE_VALUES[state] ?? "OPEN"} />,
    }));
  }
  if (key === "assignee" || key === "author") {
    const users = ["@me", ...vocab.users];
    return users.filter(matches).map((login) => ({
      insert: `${key}:${login} `,
      label: login === "@me" && viewer !== null ? `@me (${viewer})` : login,
      icon:
        login === "@me" ? (
          viewer !== null ? <Avatar login={viewer} size="size-4" /> : undefined
        ) : (
          <Avatar login={login} size="size-4" />
        ),
    }));
  }
  if (key === "label") {
    return vocab.labels.filter(matches).map((label) => ({
      insert: `${key}:${quoteValue(label)} `,
      label,
    }));
  }
  if (key === "repo") {
    return vocab.repos.filter(matches).map((repo) => ({
      insert: `${key}:${repo} `,
      label: repo,
    }));
  }
  if (key === "no") {
    return ["assignee", "label"].filter(matches).map((field) => ({
      insert: `${key}:${field} `,
      label: `no:${field}`,
    }));
  }
  return [];
}

function FilterBar({
  value,
  onChange,
  items,
  repos,
  kind,
}: {
  value: string;
  onChange: (value: string) => void;
  items: Item[] | null;
  repos: RepoInfo[];
  kind: "issue" | "pr";
}) {
  const viewer = useViewer();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [highlight, setHighlight] = useState(0);

  const vocab = useMemo(() => {
    const users = new Set<string>();
    const labels = new Set<string>();
    for (const item of items ?? []) {
      if (item.author.length > 0) users.add(item.author);
      for (const login of item.assignees) users.add(login);
      for (const label of item.labels) labels.add(label);
    }
    return {
      users: [...users].sort((a, b) => a.localeCompare(b)),
      labels: [...labels].sort((a, b) => a.localeCompare(b)),
      repos: repos.map((entry) => entry.repo),
    };
  }, [items, repos]);

  // The token under the caret is what suggestions complete.
  const upToCaret = value.slice(0, caret);
  const tokenStart = upToCaret.lastIndexOf(" ") + 1;
  const token = upToCaret.slice(tokenStart);
  const suggestions = useMemo(
    () => buildSuggestions(token, vocab, kind, viewer).slice(0, 8),
    [token, vocab, kind, viewer],
  );
  const active = Math.min(highlight, Math.max(0, suggestions.length - 1));

  const syncCaret = () => setCaret(inputRef.current?.selectionStart ?? value.length);

  const accept = (suggestion: Suggestion) => {
    const next = value.slice(0, tokenStart) + suggestion.insert + value.slice(caret);
    onChange(next);
    const position = tokenStart + suggestion.insert.length;
    setCaret(position);
    setHighlight(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(position, position);
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || suggestions.length === 0) {
      if (event.key === "ArrowDown") setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((active + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((active - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      accept(suggestions[active]);
    }
  };

  return (
    <div className="relative">
      {/* Plain <input> (not the SDK Input): the typeahead needs a ref for
          caret positioning, which the SDK component doesn't forward. */}
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlight(0);
          setCaret(event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={syncCaret}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder="Filter — is:open assignee:@me label:bug, or plain text"
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        spellCheck={false}
        autoComplete="off"
      />
      {value.length > 0 ? (
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          onMouseDown={(event) => {
            event.preventDefault();
            onChange("");
            setCaret(0);
            inputRef.current?.focus();
          }}
          aria-label="Clear filter"
        >
          ✕
        </button>
      ) : null}
      {open && suggestions.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.insert}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                index === active
                  ? "bg-accent text-accent-foreground"
                  : "text-popover-foreground"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                accept(suggestion);
              }}
              onMouseEnter={() => setHighlight(index)}
            >
              {suggestion.icon}
              <span className="min-w-0 truncate font-medium">{suggestion.label}</span>
              {suggestion.hint !== undefined ? (
                <span className="ml-auto shrink-0 pl-4 text-xs text-muted-foreground">
                  {suggestion.hint}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list: a column-headed table.
// ---------------------------------------------------------------------------

// Shared column widths so the header row lines up with item rows.
const COL = {
  id: "w-12 shrink-0",
  assignee: "hidden w-28 shrink-0 lg:block",
  status: "w-28 shrink-0",
  updated: "hidden w-16 shrink-0 text-right md:block",
  actions: "flex w-32 shrink-0 items-center justify-end gap-1",
} as const;

function AssigneeCell({ assignees }: { assignees: string[] }) {
  if (assignees.length === 0) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  return (
    <span className="flex items-center -space-x-1.5" title={assignees.join(", ")}>
      {assignees.slice(0, 3).map((login) => (
        <Avatar key={login} login={login} className="ring-1 ring-card" />
      ))}
      {assignees.length > 3 ? (
        <span className="pl-2.5 text-xs text-muted-foreground">+{assignees.length - 3}</span>
      ) : null}
    </span>
  );
}

/** Inline status control: a dropdown for issues, a static badge for PRs. */
function StatusCell({ item }: { item: Item }) {
  const { setIssueState } = useIssueMutations();
  const [pending, setPending] = useState(false);
  if (item.kind === "pr") {
    return <StateBadge kind="pr" state={item.state} />;
  }
  const change = (next: "open" | "closed") => {
    if ((item.state === "OPEN") === (next === "open")) return;
    setPending(true);
    setIssueState(item.repo, item.number, next)
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => setPending(false));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={pending}>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs font-normal"
          onClick={(event) => event.stopPropagation()}
        >
          <StateDot kind="issue" state={item.state} />
          {pending ? "…" : item.state.toLowerCase()}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => change("open")}>
          <StateDot kind="issue" state="OPEN" />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => change("closed")}>
          <StateDot kind="issue" state="CLOSED" />
          Closed
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowMenu({ item }: { item: Item }) {
  const viewer = useViewer();
  const { setIssueState, setAssignees } = useIssueMutations();
  const assignedToMe = viewer !== null && item.assignees.includes(viewer);

  const toggleSelfAssign = () => {
    if (viewer === null) return;
    const next = assignedToMe
      ? item.assignees.filter((login) => login !== viewer)
      : [...item.assignees, viewer];
    setAssignees(item.repo, item.number, next)
      .then(() => toast.success(assignedToMe ? `Unassigned from #${item.number}` : `Assigned to #${item.number}`))
      .catch((error: unknown) => toast.error(errorText(error)));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-muted-foreground"
          onClick={(event) => event.stopPropagation()}
        >
          ⋮
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {item.kind === "issue" && viewer !== null ? (
          <DropdownMenuItem onSelect={toggleSelfAssign}>
            {assignedToMe ? "Unassign me" : "Assign to me"}
          </DropdownMenuItem>
        ) : null}
        {item.kind === "issue" ? (
          <DropdownMenuItem
            onSelect={() =>
              setIssueState(item.repo, item.number, item.state === "OPEN" ? "closed" : "open").catch(
                (error: unknown) => toast.error(errorText(error)),
              )
            }
          >
            {item.state === "OPEN" ? "Close issue" : "Reopen issue"}
          </DropdownMenuItem>
        ) : null}
        {item.kind === "issue" ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem onSelect={() => window.open(item.url, "_blank")}>
          Open on GitHub ↗
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            navigator.clipboard.writeText(item.url).then(
              () => toast.success("Link copied"),
              () => toast.error("Could not copy the link"),
            );
          }}
        >
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ItemRow({
  item,
  links,
  onOpen,
}: {
  item: Item;
  links: ThreadLink[] | undefined;
  onOpen: () => void;
}) {
  const { spawn, spawningKey } = useSpawn();
  const busy = spawningKey === `${item.repo}#${item.number}`;
  return (
    <div
      className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/50"
      onClick={onOpen}
    >
      <span className={`${COL.id} font-mono text-xs text-muted-foreground`}>
        #{item.number}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate text-sm text-foreground">{item.title}</span>
        <LabelChips labels={item.labels} className="hidden shrink-0 xl:flex" />
        <ThreadPills links={links} />
      </span>
      <span className={`${COL.assignee} text-xs text-muted-foreground`}>
        <AssigneeCell assignees={item.assignees} />
      </span>
      <span className={COL.status}>
        <StatusCell item={item} />
      </span>
      <span className={`${COL.updated} text-xs text-muted-foreground`}>
        {relativeTime(item.updatedAt)}
      </span>
      <span className={COL.actions}>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={spawningKey !== null}
          onClick={(event) => {
            event.stopPropagation();
            spawn(item.kind === "issue" ? "startWork" : "startReview", item.repo, item.number);
          }}
        >
          {busy ? "…" : item.kind === "issue" ? "Start" : "Review"}
        </Button>
        <RowMenu item={item} />
      </span>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="divide-y divide-border">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-3 px-3 py-3">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="hidden h-3 w-24 lg:block" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="hidden h-3 w-12 md:block" />
        </div>
      ))}
    </div>
  );
}

function ItemsTable({
  kind,
  items,
  error,
  hasFilter,
  onOpenItem,
}: {
  kind: "issue" | "pr";
  items: Item[] | null;
  error: string | null;
  hasFilter: boolean;
  onOpenItem: (repo: string, number: number) => void;
}) {
  const links = useLinks();

  let body: React.ReactNode;
  if (error !== null) {
    body = <EmptyState message={error} />;
  } else if (items === null) {
    body = <TableSkeleton />;
  } else if (items.length === 0) {
    body = (
      <EmptyState
        message={
          hasFilter
            ? `No ${kind === "issue" ? "issues" : "pull requests"} match this filter.`
            : `No ${kind === "issue" ? "issues" : "pull requests"} in the tracked repos.`
        }
      />
    );
  } else {
    body = (
      <div className="divide-y divide-border">
        {items.map((item) => (
          <ItemRow
            key={`${item.repo}#${item.number}`}
            item={item}
            links={links[`${kind}:${item.repo}#${item.number}`]}
            onOpen={() => onOpenItem(item.repo, item.number)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span className={COL.id}>ID</span>
        <span className="min-w-0 flex-1">Title</span>
        <span className={COL.assignee}>Assignee</span>
        <span className={COL.status}>Status</span>
        <span className={COL.updated}>Updated</span>
        <span className={COL.actions} />
      </div>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Issue detail: body + comments on the left, metadata sidebar on the right.
// ---------------------------------------------------------------------------

function SidebarHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

function AssigneePicker({
  repo,
  assignees,
  onToggle,
}: {
  repo: string;
  assignees: string[];
  onToggle: (login: string, assigned: boolean) => void;
}) {
  const rpc = useRpc();
  const viewer = useViewer();
  const [users, setUsers] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (users !== null) return;
    rpc.call("assignableUsers", { repo }).then(
      (result) => {
        const list = (result as { users?: unknown })?.users;
        setUsers(Array.isArray(list) ? list.map(String) : []);
      },
      (error: unknown) => setLoadError(errorText(error)),
    );
  }, [rpc, repo, users]);

  // The viewer floats to the top of the picker.
  const ordered =
    users === null
      ? null
      : [...users].sort((a, b) => Number(b === viewer) - Number(a === viewer));

  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground">
          Edit
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
        <DropdownMenuLabel>Assignees</DropdownMenuLabel>
        {loadError !== null ? (
          <DropdownMenuItem disabled>{loadError}</DropdownMenuItem>
        ) : ordered === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : ordered.length === 0 ? (
          <DropdownMenuItem disabled>No assignable users</DropdownMenuItem>
        ) : (
          ordered.map((login) => (
            <DropdownMenuCheckboxItem
              key={login}
              checked={assignees.includes(login)}
              onCheckedChange={(checked) => onToggle(login, checked)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Avatar login={login} size="size-4" />
                <span className="truncate">
                  {login}
                  {login === viewer ? " (you)" : ""}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LabelPicker({
  repo,
  labels,
  onToggle,
}: {
  repo: string;
  labels: string[];
  onToggle: (label: string, enabled: boolean) => void;
}) {
  const rpc = useRpc();
  const [available, setAvailable] = useState<string[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (available !== null) return;
    rpc.call("repositoryLabels", { repo }).then(
      (result) => {
        const list = (result as { labels?: unknown })?.labels;
        setAvailable(Array.isArray(list) ? list.map(String) : []);
      },
      (error: unknown) => setLoadError(errorText(error)),
    );
  }, [rpc, repo, available]);

  const ordered =
    available === null
      ? null
      : [...new Set([...labels, ...available])].sort((a, b) => a.localeCompare(b));

  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground">
          Edit
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
        <DropdownMenuLabel>Labels</DropdownMenuLabel>
        {loadError !== null ? (
          <DropdownMenuItem disabled>{loadError}</DropdownMenuItem>
        ) : ordered === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : ordered.length === 0 ? (
          <DropdownMenuItem disabled>No labels in repo</DropdownMenuItem>
        ) : (
          ordered.map((label) => (
            <DropdownMenuCheckboxItem
              key={label}
              checked={labels.includes(label)}
              onCheckedChange={(checked) => onToggle(label, checked === true)}
              onSelect={(event) => event.preventDefault()}
            >
              <span className="min-w-0 truncate">{label}</span>
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IssueDetailView({
  repo,
  number,
  onBack,
}: {
  repo: string;
  number: number;
  onBack: () => void;
}) {
  const rpc = useRpc();
  const links = useLinks();
  const { spawn, spawningKey } = useSpawn();
  const { setIssueState, setAssignees, setLabels } = useIssueMutations();
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(() => {
    rpc.call("getIssue", { repo, number }).then(
      (result) => {
        const issue = (result as { issue?: IssueDetail })?.issue;
        if (issue === undefined) throw new Error("malformed getIssue result");
        setDetail(issue);
        setError(null);
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [rpc, repo, number]);
  useEffect(() => {
    setDetail(null);
    load();
  }, [load]);

  const changeState = useCallback(
    (next: "open" | "closed") => {
      setDetail((prev) =>
        prev === null ? prev : { ...prev, state: next === "closed" ? "CLOSED" : "OPEN" },
      );
      setIssueState(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [setIssueState, repo, number, load],
  );

  const toggleAssignee = useCallback(
    (login: string, assigned: boolean) => {
      let next: string[] = [];
      setDetail((prev) => {
        if (prev === null) return prev;
        next = assigned
          ? [...new Set([...prev.assignees, login])]
          : prev.assignees.filter((entry) => entry !== login);
        return { ...prev, assignees: next };
      });
      setAssignees(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [setAssignees, repo, number, load],
  );

  const toggleLabel = useCallback(
    (label: string, enabled: boolean) => {
      let next: string[] = [];
      setDetail((prev) => {
        if (prev === null) return prev;
        next = enabled
          ? [...new Set([...prev.labels, label])]
          : prev.labels.filter((entry) => entry !== label);
        return { ...prev, labels: next };
      });
      setLabels(repo, number, next).catch((err: unknown) => {
        toast.error(errorText(err));
        load();
      });
    },
    [setLabels, repo, number, load],
  );

  const postComment = useCallback(() => {
    if (comment.trim().length === 0) return;
    setPosting(true);
    rpc
      .call("commentIssue", { repo, number, body: comment })
      .then(() => {
        setComment("");
        load();
      })
      .catch((err: unknown) => toast.error(errorText(err)))
      .finally(() => setPosting(false));
  }, [rpc, repo, number, comment, load]);

  if (error !== null) return <EmptyState message={error} />;
  if (detail === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const issueLinks = links[`issue:${repo}#${number}`];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onBack}>
          ← Issues
        </Button>
        <span>
          {repo} · #{number}
        </span>
        <span className="flex-1" />
        <a
          href={detail.url}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground"
        >
          Open on GitHub ↗
        </a>
      </div>

      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-xl font-semibold text-foreground">
          {detail.title}{" "}
          <span className="font-normal text-muted-foreground">#{detail.number}</span>
        </h2>
        <Button
          size="sm"
          disabled={spawningKey !== null}
          onClick={() => spawn("startWork", repo, number)}
        >
          {spawningKey !== null ? "Starting…" : "Send agent"}
        </Button>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
              <Avatar login={detail.author} />
              <span className="font-medium text-foreground">{detail.author}</span>
              opened this issue · updated {relativeTime(detail.updatedAt)}
            </div>
            <div className="p-4">
              {detail.body.length > 0 ? (
                <Markdown content={detail.body} className="text-sm" />
              ) : (
                <p className="text-sm text-muted-foreground">(no description)</p>
              )}
            </div>
          </div>

          {detail.comments.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">
                Activity · {detail.comments.length}
              </h3>
              {detail.comments.map((entry, index) => (
                <div key={index} className="rounded-lg border border-border bg-card p-3">
                  <p className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Avatar login={entry.author} />
                    <span className="font-medium text-foreground">{entry.author}</span> ·{" "}
                    {relativeTime(entry.createdAt)}
                  </p>
                  <Markdown content={entry.body} className="text-sm" />
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Leave a comment…"
              rows={3}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={posting || comment.trim().length === 0}
                onClick={postComment}
              >
                {posting ? "Posting…" : "Comment"}
              </Button>
            </div>
          </div>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-5 lg:w-56">
          <div className="flex flex-col gap-2">
            <SidebarHeading>Status</SidebarHeading>
            <Select
              value={detail.state === "OPEN" ? "open" : "closed"}
              onValueChange={(value) => changeState(value === "closed" ? "closed" : "open")}
            >
              <SelectTrigger className="h-8 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  <span className="flex items-center gap-2">
                    <StateDot kind="issue" state="OPEN" /> Open
                  </span>
                </SelectItem>
                <SelectItem value="closed">
                  <span className="flex items-center gap-2">
                    <StateDot kind="issue" state="CLOSED" /> Closed
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <SidebarHeading>Assignees</SidebarHeading>
              <AssigneePicker repo={repo} assignees={detail.assignees} onToggle={toggleAssignee} />
            </div>
            {detail.assignees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one assigned</p>
            ) : (
              detail.assignees.map((login) => (
                <p key={login} className="flex items-center gap-2 text-sm text-foreground">
                  <Avatar login={login} />
                  <span className="truncate">{login}</span>
                </p>
              ))
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <SidebarHeading>Labels</SidebarHeading>
              <LabelPicker repo={repo} labels={detail.labels} onToggle={toggleLabel} />
            </div>
            {detail.labels.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet</p>
            ) : (
              <LabelChips labels={detail.labels} className="flex flex-wrap" />
            )}
          </div>

          {issueLinks !== undefined && issueLinks.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <SidebarHeading>Agents</SidebarHeading>
              <ThreadPills links={issueLinks} />
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pull request detail — the VS Code-style PR view. One component serves both
// the nav panel (two-column with a metadata sidebar) and the thread side
// panel (compact single column via `compact`).
// ---------------------------------------------------------------------------

function pullStateBadgeParts(state: string): { dot: string; label: string } {
  if (state === "DRAFT") return { dot: "bg-muted-foreground/60", label: "draft" };
  if (state === "OPEN") return { dot: "bg-green-500", label: "open" };
  if (state === "MERGED") return { dot: "bg-purple-500", label: "merged" };
  return { dot: "bg-red-500", label: "closed" };
}

function PullStateBadge({ state }: { state: string }) {
  const { dot, label } = pullStateBadgeParts(state);
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      {label}
    </Badge>
  );
}

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
  PENDING: "review requested",
};

function reviewStateClass(state: string): string {
  if (state === "APPROVED") return "text-green-600 dark:text-green-400";
  if (state === "CHANGES_REQUESTED") return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}

function ReviewDecisionBadge({ decision }: { decision: string }) {
  if (decision === "APPROVED") {
    return <Badge className="bg-green-600 text-white hover:bg-green-600">approved</Badge>;
  }
  if (decision === "CHANGES_REQUESTED") {
    return <Badge variant="destructive">changes requested</Badge>;
  }
  if (decision === "REVIEW_REQUIRED") {
    return <Badge variant="secondary">review required</Badge>;
  }
  return null;
}

function checkDotClass(status: PullCheck["status"]): string {
  if (status === "success") return "bg-green-500";
  if (status === "failure") return "bg-red-500";
  if (status === "pending") return "animate-pulse bg-yellow-500";
  return "bg-muted-foreground/50";
}

function ChecksSection({ checks }: { checks: PullCheck[] }) {
  const [open, setOpen] = useState(() => checks.some((check) => check.status === "failure"));
  if (checks.length === 0) return null;
  const passing = checks.filter((check) => check.status === "success").length;
  const failing = checks.filter((check) => check.status === "failure").length;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span
          className={`size-2 shrink-0 rounded-full ${
            failing > 0 ? "bg-red-500" : passing === checks.length ? "bg-green-500" : "animate-pulse bg-yellow-500"
          }`}
        />
        <span className="font-medium text-foreground">Checks</span>
        <span className="text-xs text-muted-foreground">
          {passing}/{checks.length} passing{failing > 0 ? ` · ${failing} failing` : ""}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="divide-y divide-border border-t border-border">
          {checks.map((check, index) => (
            <div key={`${check.name}-${index}`} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <span className={`size-2 shrink-0 rounded-full ${checkDotClass(check.status)}`} />
              <span className="min-w-0 flex-1 truncate text-foreground">{check.name}</span>
              {check.url.length > 0 ? (
                <a
                  href={check.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-muted-foreground underline hover:text-foreground"
                >
                  details ↗
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The host toggles dark mode via a `dark` class on <html>; pierre's diff
    themes are picked per render, so track it live. */
function useIsDarkTheme(): boolean {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark")),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/**
 * A patch (or single `@@` hunk) rendered through the host's @pierre/diffs —
 * syntax highlighting included (the host provides the worker pool via
 * context). GitHub's REST patches lack the `diff --git` header, so one is
 * synthesized; unparseable input falls back to plain mono text.
 */
function DiffPatch({ path, patch }: { path: string; patch: string }) {
  const dark = useIsDarkTheme();
  const fileDiff = useMemo<FileDiffMetadata | null>(() => {
    const normalized = patch.replace(/\r\n/g, "\n").trimEnd();
    if (normalized.length === 0) return null;
    const text = normalized.startsWith("diff --git")
      ? `${normalized}\n`
      : `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${normalized}\n`;
    try {
      return parsePatchFiles(text)[0]?.files[0] ?? null;
    } catch {
      return null;
    }
  }, [path, patch]);
  const options = useMemo(
    () =>
      ({
        diffStyle: "unified",
        overflow: "scroll",
        disableFileHeader: true,
        themeType: dark ? "dark" : "light",
      }) as const,
    [dark],
  );
  if (fileDiff === null) {
    return (
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-5 text-foreground/80">
        {patch}
      </pre>
    );
  }
  return <PierreFileDiff fileDiff={fileDiff} options={options} />;
}

function FileDiffCard({ file, url }: { file: PullFile; url: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="shrink-0 text-xs text-muted-foreground">{open ? "▾" : "▸"}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
          {file.path}
        </span>
        {file.status !== "modified" ? (
          <Badge variant="secondary" className="shrink-0 font-normal text-muted-foreground">
            {file.status}
          </Badge>
        ) : null}
        <span className="shrink-0 text-xs text-green-600 dark:text-green-400">
          +{file.additions}
        </span>
        <span className="shrink-0 text-xs text-red-600 dark:text-red-400">
          −{file.deletions}
        </span>
      </button>
      {open ? (
        file.patch !== null ? (
          <div className="border-t border-border">
            <DiffPatch path={file.path} patch={file.patch} />
          </div>
        ) : (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            Diff too large to inline —{" "}
            <a href={`${url}/files`} target="_blank" rel="noreferrer" className="underline">
              view on GitHub ↗
            </a>
          </p>
        )
      ) : null}
    </div>
  );
}

/** An inline review thread: file/line header, the tail of its diff hunk for
    context, then the comment chain. */
function ReviewThreadCard({ thread }: { thread: ReviewThread }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <p className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 font-mono text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{thread.path}</span>
        {thread.line !== null ? <span className="shrink-0">:{thread.line}</span> : null}
      </p>
      {thread.diffHunk.length > 0 ? (
        <div className="border-b border-border">
          <DiffPatch path={thread.path} patch={thread.diffHunk} />
        </div>
      ) : null}
      <div className="flex flex-col gap-3 p-3">
        {thread.comments.map((entry, index) => (
          <div key={index}>
            <p className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <Avatar login={entry.author} size="size-4" />
              <span className="font-medium text-foreground">{entry.author}</span> ·{" "}
              {relativeTime(entry.createdAt)}
            </p>
            <Markdown content={entry.body} className="text-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

type PullTimelineEntry =
  | { type: "comment"; author: string; body: string; createdAt: string }
  | { type: "review"; author: string; state: string; body: string; createdAt: string };

function PullTimeline({ pull }: { pull: PullDetail }) {
  const entries = useMemo<PullTimelineEntry[]>(() => {
    const merged: PullTimelineEntry[] = [
      ...pull.comments.map((comment) => ({ type: "comment" as const, ...comment })),
      // Body-less COMMENTED reviews are the containers of inline threads
      // (rendered separately below); showing them here would be noise.
      ...pull.reviews
        .filter((review) => review.body.length > 0 || review.state !== "COMMENTED")
        .map((review) => ({ type: "review" as const, ...review })),
    ];
    return merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [pull]);
  if (entries.length === 0 && pull.reviewThreads.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">
        Activity · {entries.length + pull.reviewThreads.length}
      </h3>
      {entries.map((entry, index) => (
        <div key={index} className="rounded-lg border border-border bg-card p-3">
          <p className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <Avatar login={entry.author} />
            <span className="font-medium text-foreground">{entry.author}</span>
            {entry.type === "review" ? (
              <span className={`font-medium ${reviewStateClass(entry.state)}`}>
                {REVIEW_STATE_LABELS[entry.state] ?? entry.state.toLowerCase()}
              </span>
            ) : null}
            · {relativeTime(entry.createdAt)}
          </p>
          {entry.body.length > 0 ? <Markdown content={entry.body} className="text-sm" /> : null}
        </div>
      ))}
      {pull.reviewThreads.map((thread, index) => (
        <ReviewThreadCard key={index} thread={thread} />
      ))}
    </div>
  );
}

function PullReviewersList({ pull }: { pull: PullDetail }) {
  const rows = useMemo(() => {
    const latest = new Map<string, { login: string; state: string }>();
    for (const review of pull.reviews) {
      if (review.author.length > 0) {
        latest.set(review.author, { login: review.author, state: review.state });
      }
    }
    for (const login of pull.reviewRequests) {
      latest.set(login, { login, state: "PENDING" });
    }
    return [...latest.values()];
  }, [pull]);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No reviewers</p>;
  return (
    <>
      {rows.map((row) => (
        <p key={row.login} className="flex items-center gap-2 text-sm text-foreground">
          <Avatar login={row.login} />
          <span className="min-w-0 truncate">{row.login}</span>
          <span className={`ml-auto shrink-0 text-xs ${reviewStateClass(row.state)}`}>
            {REVIEW_STATE_LABELS[row.state] ?? row.state.toLowerCase()}
          </span>
        </p>
      ))}
    </>
  );
}

function PullCommentBox({
  repo,
  number,
  onPosted,
}: {
  repo: string;
  number: number;
  onPosted: () => void;
}) {
  const rpc = useRpc();
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const post = useCallback(() => {
    if (comment.trim().length === 0) return;
    setPosting(true);
    rpc
      .call("commentPull", { repo, number, body: comment })
      .then(() => {
        setComment("");
        onPosted();
      })
      .catch((error: unknown) => toast.error(errorText(error)))
      .finally(() => setPosting(false));
  }, [rpc, repo, number, comment, onPosted]);
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Leave a comment…"
        rows={3}
      />
      <div className="flex justify-end">
        <Button size="sm" disabled={posting || comment.trim().length === 0} onClick={post}>
          {posting ? "Posting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}

function PullDetailView({
  repo,
  number,
  onBack,
  backLabel = "Pull requests",
  compact = false,
}: {
  repo: string;
  number: number;
  onBack?: () => void;
  backLabel?: string;
  compact?: boolean;
}) {
  const rpc = useRpc();
  const links = useLinks();
  const { spawn, spawningKey } = useSpawn();
  const [pull, setPull] = useState<PullDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    rpc.call("getPull", { repo, number }).then(
      (result) => {
        const detail = (result as { pull?: PullDetail })?.pull;
        if (detail === undefined) throw new Error("malformed getPull result");
        setPull(detail);
        setError(null);
      },
      (err: unknown) => setError(errorText(err)),
    );
  }, [rpc, repo, number]);
  useEffect(() => {
    setPull(null);
    load();
  }, [load]);

  if (error !== null) return <EmptyState message={error} />;
  if (pull === null) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const pullLinks = links[`pr:${repo}#${number}`];
  const mainColumn = (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <ChecksSection checks={pull.checks} />

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
          <Avatar login={pull.author} />
          <span className="font-medium text-foreground">{pull.author}</span>
          opened this pull request · updated {relativeTime(pull.updatedAt)}
        </div>
        <div className="p-4">
          {pull.body.length > 0 ? (
            <Markdown content={pull.body} className="text-sm" />
          ) : (
            <p className="text-sm text-muted-foreground">(no description)</p>
          )}
        </div>
      </div>

      <PullTimeline pull={pull} />

      {pull.files.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">
            Files changed · {pull.files.length}
            <span className="ml-2 font-normal">
              <span className="text-green-600 dark:text-green-400">+{pull.additions}</span>{" "}
              <span className="text-red-600 dark:text-red-400">−{pull.deletions}</span>
            </span>
          </h3>
          {pull.files.map((file) => (
            <FileDiffCard key={file.path} file={file} url={pull.url} />
          ))}
        </div>
      ) : null}

      <PullCommentBox repo={repo} number={number} onPosted={load} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {onBack !== undefined ? (
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onBack}>
            ← {backLabel}
          </Button>
        ) : null}
        <span className="min-w-0 truncate">
          {repo} · #{number}
        </span>
        <span className="flex-1" />
        <a
          href={pull.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 underline hover:text-foreground"
        >
          Open on GitHub ↗
        </a>
      </div>

      <div className="flex items-start gap-3">
        <h2
          className={`min-w-0 flex-1 font-semibold text-foreground ${compact ? "text-base" : "text-xl"}`}
        >
          {pull.title} <span className="font-normal text-muted-foreground">#{pull.number}</span>
        </h2>
        <Button
          size="sm"
          disabled={spawningKey !== null}
          onClick={() => spawn("startReview", repo, number)}
        >
          {spawningKey !== null ? "Starting…" : "Review with agent"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <PullStateBadge state={pull.state} />
        <ReviewDecisionBadge decision={pull.reviewDecision} />
        <span className="font-mono">
          {pull.baseRefName} ← {pull.headRefName}
        </span>
        <span>
          <span className="text-green-600 dark:text-green-400">+{pull.additions}</span>{" "}
          <span className="text-red-600 dark:text-red-400">−{pull.deletions}</span> ·{" "}
          {pull.changedFiles} file{pull.changedFiles === 1 ? "" : "s"}
        </span>
        <LabelChips labels={pull.labels} className="flex flex-wrap" />
        <ThreadPills links={pullLinks} />
      </div>

      {compact ? (
        mainColumn
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row">
          {mainColumn}
          <aside className="flex w-full shrink-0 flex-col gap-5 lg:w-56">
            <div className="flex flex-col gap-1">
              <SidebarHeading>Reviewers</SidebarHeading>
              <PullReviewersList pull={pull} />
            </div>
            <div className="flex flex-col gap-1">
              <SidebarHeading>Assignees</SidebarHeading>
              {pull.assignees.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one assigned</p>
              ) : (
                pull.assignees.map((login) => (
                  <p key={login} className="flex items-center gap-2 text-sm text-foreground">
                    <Avatar login={login} />
                    <span className="truncate">{login}</span>
                  </p>
                ))
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <SidebarHeading>Labels</SidebarHeading>
              {pull.labels.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet</p>
              ) : (
                <LabelChips labels={pull.labels} className="flex flex-wrap" />
              )}
            </div>
            {pullLinks !== undefined && pullLinks.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <SidebarHeading>Agents</SidebarHeading>
                <ThreadPills links={pullLinks} />
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The thread side panel (threadPanelAction): auto-resolve the thread's own PR
// (its environment branch's PR, else the PR it was spawned to review) and
// show the compact PR view; fall back to a picker over cached open PRs.
// ---------------------------------------------------------------------------

function PullPickerList({ onPick }: { onPick: (repo: string, number: number) => void }) {
  const { items, error } = useItems("pr");
  if (error !== null) return <EmptyState message={error} />;
  if (items === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-5/6" />
        <Skeleton className="h-5 w-2/3" />
      </div>
    );
  }
  const open = items.filter((item) => item.state === "OPEN");
  if (open.length === 0) {
    return <EmptyState message="No open pull requests in the tracked repos." />;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="divide-y divide-border">
        {open.map((item) => (
          <button
            key={`${item.repo}#${item.number}`}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50"
            onClick={() => onPick(item.repo, item.number)}
          >
            <StateDot kind="pr" state={item.state} />
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              #{item.number}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.title}</span>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
              {item.repo}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PullPanelTab({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc();
  const [resolved, setResolved] = useState(false);
  const [selected, setSelected] = useState<{ repo: string; number: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.call("pullForThread", { threadId }).then(
      (result) => {
        if (cancelled) return;
        const pull = (result as { pull?: { repo?: unknown; number?: unknown } | null })?.pull;
        if (pull && typeof pull.repo === "string" && typeof pull.number === "number") {
          setSelected({ repo: pull.repo, number: pull.number });
        }
        setResolved(true);
      },
      () => {
        if (!cancelled) setResolved(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId]);

  if (!resolved) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (selected === null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          No pull request is linked to this thread yet — pick one:
        </p>
        <PullPickerList onPick={(repo, number) => setSelected({ repo, number })} />
      </div>
    );
  }
  return (
    <PullDetailView
      repo={selected.repo}
      number={selected.number}
      compact
      backLabel="All PRs"
      onBack={() => setSelected(null)}
    />
  );
}

// ---------------------------------------------------------------------------
// New issue form.
// ---------------------------------------------------------------------------

function NewIssueForm({
  repos,
  onCreated,
  onCancel,
}: {
  repos: RepoInfo[];
  onCreated: (repo: string, number: number | null) => void;
  onCancel: () => void;
}) {
  const rpc = useRpc();
  const [repo, setRepo] = useState(repos[0]?.repo ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [creating, setCreating] = useState(false);

  const create = useCallback(() => {
    setCreating(true);
    rpc
      .call("createIssue", { repo, title, body })
      .then((result) => {
        const number = (result as { number?: unknown })?.number;
        toast.success("Issue created");
        onCreated(repo, typeof number === "number" ? number : null);
      })
      .catch((err: unknown) => toast.error(errorText(err)))
      .finally(() => setCreating(false));
  }, [rpc, repo, title, body, onCreated]);

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">New issue</h2>
      <Select value={repo} onValueChange={setRepo}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Repository" />
        </SelectTrigger>
        <SelectContent>
          {repos.map((entry) => (
            <SelectItem key={entry.repo} value={entry.repo}>
              {entry.repo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title"
      />
      <Textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Description (markdown)"
        rows={8}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={creating || title.trim().length === 0 || repo.length === 0}
          onClick={create}
        >
          {creating ? "Creating…" : "Create issue"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel: tab bar + filters + routed body.
// ---------------------------------------------------------------------------

interface Status {
  ghOk: boolean;
  ghError: string | null;
  repos: RepoInfo[];
  lastSyncedAt: string | null;
}

function useStatus(): { status: Status | null; refetch: () => void } {
  const rpc = useRpc();
  const [status, setStatus] = useState<Status | null>(null);
  const refetch = useCallback(() => {
    rpc.call("status").then(
      (result) => setStatus(result as Status),
      () => {},
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("data-changed", refetch);
  return { status, refetch };
}

function PanelHeader() {
  const rpc = useRpc();
  const { status } = useStatus();
  const [syncing, setSyncing] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => {
    setSyncing(true);
    setFailed(false);
    rpc
      .call("refresh")
      .catch(() => setFailed(true))
      .finally(() => setSyncing(false));
  }, [rpc]);
  return (
    <>
      <span className="text-xs text-muted-foreground">
        {failed
          ? "Sync failed — check `gh auth status`"
          : status === null
            ? "Loading…"
            : status.ghOk
              ? `${status.repos.length} repo${status.repos.length === 1 ? "" : "s"} · synced ${
                  status.lastSyncedAt !== null ? relativeTime(status.lastSyncedAt) : "never"
                }`
              : "GitHub CLI not authenticated"}
      </span>
      <Button size="sm" variant="outline" disabled={syncing} onClick={refresh}>
        {syncing ? "Syncing…" : "Refresh"}
      </Button>
    </>
  );
}

const QUERY_KEY = "bb-plugin-github:query";
const DEFAULT_QUERY = "is:open ";

function GithubPanel({ subPath }: PluginNavPanelProps) {
  const [route, navigate] = useSubPathRoute(subPath);
  const { status } = useStatus();
  const [query, setQueryState] = useState<string>(() => {
    try {
      return window.localStorage.getItem(QUERY_KEY) ?? DEFAULT_QUERY;
    } catch {
      return DEFAULT_QUERY;
    }
  });
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    try {
      window.localStorage.setItem(QUERY_KEY, next);
    } catch {
      // private mode / storage disabled — the filter just won't persist
    }
  }, []);

  return (
    <PageBody className="max-w-5xl">
      <GithubPanelBody
        route={route}
        navigate={navigate}
        status={status}
        query={query}
        setQuery={setQuery}
      />
    </PageBody>
  );
}

function ListView({
  kind,
  query,
  setQuery,
  repos,
  onOpenItem,
}: {
  kind: "issue" | "pr";
  query: string;
  setQuery: (query: string) => void;
  repos: RepoInfo[];
  onOpenItem: (repo: string, number: number) => void;
}) {
  const { items, error } = useItems(kind);
  const viewer = useViewer();
  const parsed = useMemo(() => parseQuery(query), [query]);
  const filtered = useMemo(
    () => (items === null ? null : items.filter((item) => matchesQuery(item, parsed, viewer))),
    [items, parsed, viewer],
  );
  return (
    <>
      <FilterBar value={query} onChange={setQuery} items={items} repos={repos} kind={kind} />
      <ItemsTable
        kind={kind}
        items={filtered}
        error={error}
        hasFilter={query.trim().length > 0}
        onOpenItem={onOpenItem}
      />
    </>
  );
}

function GithubPanelBody({
  route,
  navigate,
  status,
  query,
  setQuery,
}: {
  route: Route;
  navigate: (route: Route) => void;
  status: Status | null;
  query: string;
  setQuery: (query: string) => void;
}) {
  if (status !== null && !status.ghOk) {
    return (
      <EmptyState
        message={`GitHub CLI is not available or not authenticated. Install it from cli.github.com, run \`gh auth login\`, then reload the plugin. (${status.ghError ?? ""})`}
      />
    );
  }
  if (status !== null && status.repos.length === 0) {
    return (
      <EmptyState message="No GitHub repos tracked yet. Create a BB project whose checkout has a GitHub origin remote, or add repos via the extraRepos plugin setting." />
    );
  }

  if (route.view === "issue") {
    return (
      <IssueDetailView
        repo={route.repo}
        number={route.number}
        onBack={() => navigate({ view: "issues" })}
      />
    );
  }
  if (route.view === "pull") {
    return (
      <PullDetailView
        repo={route.repo}
        number={route.number}
        onBack={() => navigate({ view: "pulls" })}
      />
    );
  }
  if (route.view === "new") {
    return (
      <NewIssueForm
        repos={status?.repos ?? []}
        onCreated={(repo, number) =>
          navigate(number !== null ? { view: "issue", repo, number } : { view: "issues" })
        }
        onCancel={() => navigate({ view: "issues" })}
      />
    );
  }

  const kind = route.view === "pulls" ? "pr" : "issue";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Tabs
          value={route.view}
          onValueChange={(value) => {
            navigate(value === "pulls" ? { view: "pulls" } : { view: "issues" });
          }}
        >
          <TabsList>
            <TabsTrigger value="issues">Issues</TabsTrigger>
            <TabsTrigger value="pulls">Pull requests</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex-1" />
        {route.view === "issues" ? (
          <Button size="sm" onClick={() => navigate({ view: "new" })}>
            New issue
          </Button>
        ) : null}
      </div>

      <ListView
        kind={kind}
        query={query}
        setQuery={setQuery}
        repos={status?.repos ?? []}
        onOpenItem={(repo, number) =>
          navigate(kind === "pr" ? { view: "pull", repo, number } : { view: "issue", repo, number })
        }
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "github",
    title: "GitHub",
    icon: "Github",
    path: "github",
    component: GithubPanel,
    headerContent: PanelHeader,
  });
  app.slots.threadPanelAction({
    id: "pull",
    title: "GitHub PR",
    icon: "Github",
    component: PullPanelTab,
  });
});
