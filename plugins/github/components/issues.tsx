import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  experimental_Icon as Icon,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  issueGroups,
  parseQuery,
  splitTitle,
  type Item,
} from "../app-logic.js";
import type { githubRpcContract } from "../server.js";
import { AgentSheet, type AgentTarget } from "./agent-sheet.js";
import { Markdown } from "./markdown-lite.js";
import { AgentLine } from "./next-step.js";
import {
  activityLabel,
  copyText,
  isInFlight,
  markSettled,
  setActivity,
  settleActivity,
  useActivities,
  type Activity,
} from "./pull-actions.js";
import {
  GroupHeader,
  HEADER_CLASS,
  ListMessage,
  NoMatch,
  ListSkeleton,
} from "./pull-list.js";
import { IssueStateMenu } from "./pull-state.js";
import { MenuHeading } from "./row-menu.js";
import { ActivitySkeleton, CommentBox, IssueActivity } from "./pull-tabs.js";
import {
  authorName,
  Avatar,
  compactAge,
  errorText,
  AgentGlyph,
  isTyping,
  itemKey,
  PullAuthor,
  relativeTime,
  SectionHeading,
  SpinnerIcon,
  TipButton,
  useAgents,
  useItems,
  useNow,
  useRepoSettings,
  useViewer,
  type AgentInfo,
  type IssueDetail,
  type RepoInfo,
} from "./shared.js";

interface IssueRef {
  repo: string;
  number: number;
}

type IssueState = "open" | "closed";

function sameLogin(login: string, viewer: string | null): boolean {
  return viewer !== null && login.toLowerCase() === viewer.toLowerCase();
}

function issueAgentTarget(issue: IssueRef & { title: string }): AgentTarget {
  return {
    kind: "issue",
    repo: issue.repo,
    number: issue.number,
    title: issue.title,
  };
}

function useIssueActions(): {
  setState: (issue: IssueRef, state: IssueState) => Promise<boolean>;
  setAssignees: (
    issue: IssueRef,
    next: string[],
    previous: string[],
    message: string,
  ) => Promise<boolean>;
} {
  const rpc = useRpc<typeof githubRpcContract>();
  return useMemo(() => {
    const setState = (
      issue: IssueRef,
      state: IssueState,
      undoable: boolean,
    ): Promise<boolean> => {
      const key = itemKey(issue);
      const id = `github-issue-${key}${undoable ? "" : "-undone"}`;
      const closing = state === "closed";
      setActivity(key, {
        kind: "changing",
        from: closing ? "OPEN" : "CLOSED",
        target: state,
        label: closing ? "Closing…" : "Reopening…",
      });
      return rpc
        .call("setIssueState", {
          repo: issue.repo,
          number: issue.number,
          state,
        })
        .then(
          () => {
            markSettled(key, {
              kind: "changed",
              state: closing ? "CLOSED" : "OPEN",
              label: closing ? "Closed" : "Reopened",
            });
            const back: IssueState = closing ? "open" : "closed";
            toast.success(
              state === "closed"
                ? `Closed #${issue.number}`
                : `Reopened #${issue.number}`,
              {
                id,
                ...(undoable
                  ? {
                      action: {
                        label: "Undo",
                        onClick: () => void setState(issue, back, false),
                      },
                    }
                  : {}),
              },
            );
            return true;
          },
          (error: unknown) => {
            setActivity(key, null);
            toast.error(`Couldn't update #${issue.number}`, {
              id,
              description: errorText(error),
            });
            return false;
          },
        );
    };
    const setAssignees = (
      issue: IssueRef,
      next: string[],
      previous: string[],
      message: string,
      undoable = true,
    ): Promise<boolean> => {
      const id = `github-assign-${itemKey(issue)}${undoable ? "" : "-undone"}`;
      return rpc
        .call("setAssignees", {
          repo: issue.repo,
          number: issue.number,
          assignees: next,
        })
        .then(
          () => {
            toast.success(message, {
              id,
              ...(undoable
                ? {
                    action: {
                      label: "Undo",
                      onClick: () =>
                        void setAssignees(
                          issue,
                          previous,
                          next,
                          `Assignees of #${issue.number} restored`,
                          false,
                        ),
                    },
                  }
                : {}),
            });
            return true;
          },
          (error: unknown) => {
            toast.error(`Couldn't change who's assigned to #${issue.number}`, {
              id,
              description: errorText(error),
            });
            return false;
          },
        );
    };
    return {
      setState: (issue, state) => setState(issue, state, true),
      setAssignees: (issue, next, previous, message) =>
        setAssignees(issue, next, previous, message),
    };
  }, [rpc]);
}

function assignMe(
  issue: IssueRef & { assignees: string[] },
  viewer: string,
): { next: string[]; message: string } {
  const assigned = issue.assignees.some((login) => sameLogin(login, viewer));
  return assigned
    ? {
        next: issue.assignees.filter((login) => !sameLogin(login, viewer)),
        message: `Unassigned you from #${issue.number}`,
      }
    : {
        next: [...issue.assignees, viewer],
        message: `Assigned you to #${issue.number}`,
      };
}

function issueReason(item: Item, viewer: string | null): string | null {
  if (item.state !== "OPEN") return "Closed";
  if (item.assignees.some((login) => sameLogin(login, viewer))) {
    return "Assigned to you";
  }
  const [first, ...rest] = item.assignees;
  if (first === undefined) return null;
  return rest.length === 0
    ? `Assigned to ${first}`
    : `Assigned to ${first} +${rest.length}`;
}

function issueOpen(item: Item, activity: Activity | null): boolean {
  if (activity?.kind === "changed") return activity.state === "OPEN";
  return item.state === "OPEN";
}

function IssueMenuItems({
  item,
  open,
  viewer,
  agent,
  onStartAgent,
}: {
  item: Item;
  open: boolean;
  viewer: string | null;
  agent: AgentInfo | null;
  onStartAgent: (target: AgentTarget) => void;
}) {
  const navigate = useBbNavigate();
  const actions = useIssueActions();
  const assigned =
    viewer !== null && item.assignees.some((login) => sameLogin(login, viewer));
  return (
    <>
      <MenuHeading>
        #{item.number} · {splitTitle(item.title).text}
      </MenuHeading>
      {viewer === null ? null : (
        <DropdownMenuItem
          onSelect={() => {
            const change = assignMe(item, viewer);
            void actions.setAssignees(
              item,
              change.next,
              item.assignees,
              change.message,
            );
          }}
        >
          <Icon name="UserRound" />
          {assigned ? "Unassign me" : "Assign to me"}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        onSelect={() => void actions.setState(item, open ? "closed" : "open")}
      >
        <Icon name={open ? "CircleCheck" : "Circle"} />
        {open ? "Close issue" : "Reopen issue"}
      </DropdownMenuItem>
      {open || agent !== null ? <DropdownMenuSeparator /> : null}
      {open ? (
        <DropdownMenuItem onSelect={() => onStartAgent(issueAgentTarget(item))}>
          <Icon name="Zap" />
          Start an agent…
        </DropdownMenuItem>
      ) : null}
      {agent === null ? null : (
        <DropdownMenuItem onSelect={() => navigate.toThread(agent.threadId)}>
          <Icon name="MessageSquare" />
          Open the agent's thread
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => copyText(item.url, "link")}>
        <Icon name="Copy" />
        Copy link
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => navigate.openUrl(item.url)}>
        <Icon name="ExternalLink" />
        Open on GitHub
      </DropdownMenuItem>
    </>
  );
}

function IssueListRow({
  item,
  activity,
  viewer,
  showRepo,
  now,
  touch,
  compact,
  agent,
  onOpen,
  onStartAgent,
}: {
  item: Item;
  activity: Activity | null;
  viewer: string | null;
  showRepo: boolean;
  now: number;
  touch: boolean;
  compact: boolean;
  agent: AgentInfo | null;
  onOpen: () => void;
  onStartAgent: (target: AgentTarget) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const open = issueOpen(item, activity);
  const busy = isInFlight(activity);
  const reason =
    activity === null ? issueReason(item, viewer) : activityLabel(activity);
  const { prefix, text } = splitTitle(item.title);
  const items = (
    <IssueMenuItems
      item={item}
      open={open}
      viewer={viewer}
      agent={agent}
      onStartAgent={onStartAgent}
    />
  );
  const showMenu = !busy && !(touch && compact);
  const row = (
    <div
      className={`group/row relative flex select-none items-start gap-2 rounded-md px-2 py-1.5 @max-[35rem]/github:py-2.5 ${
        menuOpen ? "bg-state-hover" : "hover:bg-state-hover"
      }`}
    >
      <button
        type="button"
        aria-label={`#${item.number} ${item.title}${reason === null ? "" : `: ${reason}`}`}
        onClick={onOpen}
        className="absolute inset-0 cursor-default rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <span
        title={open ? "Open" : "Closed"}
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center"
      >
        <Icon
          name={open ? "Circle" : "CircleCheck"}
          aria-hidden
          className={`size-4 ${open ? "text-success" : "text-pr-merged"}`}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground @max-[35rem]/github:line-clamp-2 @max-[35rem]/github:whitespace-normal">
          {prefix === null ? null : (
            <span className="font-normal text-subtle-foreground">
              {prefix}{" "}
            </span>
          )}
          {text}
        </span>
        <span className="truncate text-xs text-subtle-foreground">
          {showRepo ? item.repo : ""}#{item.number}
          {reason === null ? null : (
            <>
              {" · "}
              <span className={busy ? "animate-shine" : undefined}>
                {reason}
              </span>
            </>
          )}
          {item.labels.length > 0 ? ` · ${item.labels.join(", ")}` : ""}
        </span>
      </span>
      <span
        className={`flex h-5 shrink-0 items-center gap-2 text-xs text-subtle-foreground tabular-nums ${
          touch
            ? ""
            : menuOpen
              ? "invisible"
              : "group-focus-within/row:invisible group-hover/row:invisible"
        }`}
      >
        {agent === null ? null : (
          <span title={agent.title} className="flex">
            <AgentGlyph agent={agent} />
          </span>
        )}
        {sameLogin(item.author, viewer) ? null : (
          <span className="flex @max-[35rem]/github:hidden">
            <PullAuthor login={item.author} />
          </span>
        )}
        <span className="min-w-6 text-right">
          {compactAge(item.updatedAt, now)}
        </span>
      </span>
      {showMenu ? (
        <span
          className={`items-center ${
            touch
              ? "relative flex"
              : `absolute top-1.5 right-1.5 ${menuOpen ? "flex" : "hidden group-focus-within/row:flex group-hover/row:flex"}`
          }`}
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={`${COARSE_POINTER_ROW_ACTION_SIZE_CLASS} text-muted-foreground hover:text-foreground data-[state=open]:bg-state-active [@media(hover:none)]:size-9`}
                aria-label={`Actions for #${item.number}`}
              >
                <Icon name="MoreHorizontal" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56"
              mobileTitle={`Actions for #${item.number}`}
            >
              {items}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ) : null}
    </div>
  );
  if (!compact || busy) return row;
  return (
    <CompactLongPressMenu
      label={`Actions for #${item.number}`}
      items={items}
      onOpenChange={setMenuOpen}
    >
      {row}
    </CompactLongPressMenu>
  );
}

export function IssuesPane({
  items,
  error,
  onRetry,
  query,
  viewer,
  showRepo,
  now,
  collapsed,
  onToggleGroup,
  onOpen,
  onStartAgent,
  onClearFilter,
}: {
  items: Item[] | null;
  error: string | null;
  onRetry: () => void;
  query: string;
  viewer: string | null;
  showRepo: boolean;
  now: number;
  collapsed: (groupId: string) => boolean;
  onToggleGroup: (groupId: string) => void;
  onOpen: (item: Item) => void;
  onStartAgent: (target: AgentTarget) => void;
  onClearFilter: () => void;
}) {
  const agents = useAgents();
  const activities = useActivities();
  const touch = useMediaQuery("(hover: none)");
  const compact = useIsCompactViewport();
  useEffect(() => {
    for (const item of items ?? []) {
      settleActivity(itemKey(item), item.state === "OPEN" ? "OPEN" : "CLOSED");
    }
  }, [items]);
  const parsed = useMemo(() => parseQuery(query), [query]);
  const groups = useMemo(
    () => (items === null ? [] : issueGroups(items, parsed, viewer)),
    [items, parsed, viewer],
  );
  if (error !== null && items === null) {
    return (
      <ListMessage
        icon="CloudOff"
        title="Can't reach GitHub"
        detail="The issues show up as soon as the connection is back."
        action={
          <Button type="button" size="sm" variant="ghost" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }
  if (items === null) return <ListSkeleton />;
  if (groups.length === 0) {
    return query.trim().length > 0 ? (
      <NoMatch
        noun="issues"
        query={query}
        viewer={viewer}
        onClear={onClearFilter}
      />
    ) : (
      <ListMessage
        icon="Circle"
        title="No issues here"
        detail="They show up here as soon as they're opened."
      />
    );
  }
  return (
    <div className="flex flex-col gap-3 pt-1.5">
      {groups.map((group) => {
        const isCollapsed = collapsed(group.id);
        return (
          <section
            key={group.id}
            aria-label={group.label}
            className="flex flex-col gap-0.5"
          >
            <GroupHeader
              label={group.label}
              count={group.rows.length}
              collapsed={isCollapsed}
              onToggle={() => onToggleGroup(group.id)}
            />
            {isCollapsed
              ? null
              : group.rows.map((item) => (
                  <IssueListRow
                    key={itemKey(item)}
                    item={item}
                    activity={activities.get(itemKey(item)) ?? null}
                    viewer={viewer}
                    showRepo={showRepo}
                    now={now}
                    touch={touch}
                    compact={compact}
                    agent={agents.get(`issue:${itemKey(item)}`) ?? null}
                    onOpen={() => onOpen(item)}
                    onStartAgent={onStartAgent}
                  />
                ))}
          </section>
        );
      })}
    </div>
  );
}

const PROPERTY_TRIGGER_CLASS =
  "-mx-2 flex min-h-8 w-[calc(100%+1rem)] min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-foreground outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-state-active max-md:pointer-coarse:min-h-10";

function PropertyValue({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-8 min-w-0 items-center py-1 text-sm text-foreground max-md:pointer-coarse:min-h-10">
      {children}
    </div>
  );
}

function PickerMenu({
  title,
  editable,
  value,
  onOpen,
  children,
}: {
  title: string;
  editable: boolean;
  value: ReactNode;
  onOpen: () => void;
  children: ReactNode;
}) {
  if (!editable) return <PropertyValue>{value}</PropertyValue>;
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onOpen();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${title}: change`}
          className={PROPERTY_TRIGGER_CLASS}
        >
          {value}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-72 w-56 overflow-y-auto"
        mobileTitle={title}
      >
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useChoices(
  load: () => Promise<string[]>,
): [string[] | null, string | null, () => void] {
  const [choices, setChoices] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetch = useCallback(() => {
    if (choices !== null) return;
    setError(null);
    load().then(setChoices, (failure: unknown) => setError(errorText(failure)));
  }, [choices, load]);
  return [choices, error, fetch];
}

function ChoiceStatus({
  error,
  loading,
  empty,
}: {
  error: string | null;
  loading: boolean;
  empty: string | null;
}) {
  const message = error ?? (loading ? "Loading…" : empty);
  if (message === null) return null;
  return (
    <DropdownMenuItem disabled>
      {loading && error === null ? <SpinnerIcon className="size-3.5" /> : null}
      <span className="min-w-0 truncate">{message}</span>
    </DropdownMenuItem>
  );
}

function AssigneePicker({
  repo,
  assignees,
  viewer,
  editable,
  onChange,
}: {
  repo: string;
  assignees: string[];
  viewer: string | null;
  editable: boolean;
  onChange: (next: string[]) => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const load = useCallback(
    () => rpc.call("assignableUsers", { repo }).then((result) => result.users),
    [repo, rpc],
  );
  const [users, error, fetch] = useChoices(load);
  const ordered =
    users === null
      ? null
      : [...new Set([...assignees, ...users])].sort(
          (a, b) =>
            Number(sameLogin(b, viewer)) - Number(sameLogin(a, viewer)) ||
            a.localeCompare(b),
        );
  const value =
    assignees.length === 0 ? (
      <span className="text-subtle-foreground">Nobody</span>
    ) : (
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {assignees.map((login) => (
          <span
            key={login}
            className="inline-flex min-w-0 items-center gap-1.5"
          >
            <Avatar login={login} size="size-4" />
            <span className="truncate">{login}</span>
          </span>
        ))}
      </span>
    );
  return (
    <PickerMenu
      title="Assignees"
      editable={editable}
      value={value}
      onOpen={fetch}
    >
      <ChoiceStatus
        error={error}
        loading={ordered === null}
        empty={ordered?.length === 0 ? "Nobody can be assigned" : null}
      />
      {(ordered ?? []).map((login) => (
        <DropdownMenuCheckboxItem
          key={login}
          checked={assignees.includes(login)}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) =>
            onChange(
              checked === true
                ? [...assignees, login]
                : assignees.filter((entry) => entry !== login),
            )
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <Avatar login={login} size="size-4" />
            <span className="truncate">
              {login}
              {sameLogin(login, viewer) ? " (you)" : ""}
            </span>
          </span>
        </DropdownMenuCheckboxItem>
      ))}
    </PickerMenu>
  );
}

function LabelPicker({
  repo,
  labels,
  editable,
  onChange,
}: {
  repo: string;
  labels: string[];
  editable: boolean;
  onChange: (next: string[]) => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const load = useCallback(
    () =>
      rpc.call("repositoryLabels", { repo }).then((result) => result.labels),
    [repo, rpc],
  );
  const [available, error, fetch] = useChoices(load);
  const ordered =
    available === null
      ? null
      : [...new Set([...labels, ...available])].sort((a, b) =>
          a.localeCompare(b),
        );
  const value =
    labels.length === 0 ? (
      <span className="text-subtle-foreground">None</span>
    ) : (
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {labels.map((label) => (
          <Badge
            key={label}
            variant="secondary"
            className="max-w-full truncate font-normal"
          >
            {label}
          </Badge>
        ))}
      </span>
    );
  return (
    <PickerMenu title="Labels" editable={editable} value={value} onOpen={fetch}>
      <ChoiceStatus
        error={error}
        loading={ordered === null}
        empty={ordered?.length === 0 ? "This repository has no labels" : null}
      />
      {(ordered ?? []).map((label) => (
        <DropdownMenuCheckboxItem
          key={label}
          checked={labels.includes(label)}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) =>
            onChange(
              checked === true
                ? [...labels, label]
                : labels.filter((entry) => entry !== label),
            )
          }
        >
          <span className="min-w-0 truncate">{label}</span>
        </DropdownMenuCheckboxItem>
      ))}
    </PickerMenu>
  );
}

function IssueSkeleton({
  title,
  number,
}: {
  title: string | null;
  number: number;
}) {
  const parts = title === null ? null : splitTitle(title);
  return (
    <div className="flex flex-col gap-2.5">
      {parts === null ? null : (
        <h1 className="text-lg font-semibold tracking-tight text-pretty text-foreground">
          {parts.prefix === null ? null : (
            <span className="font-normal text-subtle-foreground">
              {parts.prefix}{" "}
            </span>
          )}
          {parts.text}{" "}
          <span className="font-normal text-subtle-foreground">#{number}</span>
        </h1>
      )}
      <DelayedLoading>
        <div aria-hidden className="flex flex-col gap-6">
          <div className="flex flex-col gap-2.5">
            {parts === null ? <Skeleton className="h-4.5 w-4/5" /> : null}
            <div className="flex items-center gap-3 pt-0.5">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-2.5 w-2/5" />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <ActivitySkeleton />
        </div>
      </DelayedLoading>
    </div>
  );
}

export function IssueDetailView({
  repo,
  number,
  onBack,
}: {
  repo: string;
  number: number;
  onBack: () => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const navigate = useBbNavigate();
  const viewer = useViewer();
  const settings = useRepoSettings();
  const agent = useAgents().get(`issue:${repo}#${number}`) ?? null;
  const actions = useIssueActions();
  const now = useNow(30_000);
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listed =
    useItems("issue").items?.find(
      (item) => item.repo === repo && item.number === number,
    ) ?? null;
  const activity = useActivities().get(`${repo}#${number}`) ?? null;
  const pending = activity?.kind === "changing" ? activity.label : null;
  const [agentTarget, setAgentTarget] = useState<AgentTarget | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const loads = useRef(0);
  const writes = useRef(0);
  const load = useCallback(() => {
    const at = ++loads.current;
    rpc.call("getIssue", { repo, number }).then(
      (result) => {
        if (at !== loads.current || writes.current > 0) return;
        settleActivity(
          `${repo}#${number}`,
          result.issue.state === "OPEN" ? "OPEN" : "CLOSED",
        );
        setDetail(result.issue);
        setError(null);
      },
      (failure: unknown) => {
        if (at === loads.current) setError(errorText(failure));
      },
    );
  }, [number, repo, rpc]);
  useEffect(() => {
    load();
  }, [load]);
  useRealtime("data-changed", load);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (agentTarget !== null || isTyping(event.target)) return;
      const root = rootRef.current;
      if (
        event.target !== document.body &&
        !(event.target instanceof Node && root?.contains(event.target))
      ) {
        return;
      }
      event.preventDefault();
      onBack();
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [agentTarget, onBack]);

  const url = detail?.url ?? `https://github.com/${repo}/issues/${number}`;
  const write = settings?.[repo]?.viewerCanWrite === true;
  const canEdit =
    write || (detail !== null && sameLogin(detail.author, viewer));
  const open =
    activity?.kind === "changed"
      ? activity.state === "OPEN"
      : detail?.state === "OPEN";

  const changeState = (state: IssueState) => {
    if (detail === null || pending !== null) return;
    void actions.setState({ repo, number }, state).then((ok) => {
      if (ok) {
        setDetail((current) =>
          current === null
            ? current
            : { ...current, state: state === "closed" ? "CLOSED" : "OPEN" },
        );
      }
    });
  };
  const tracked = <T,>(request: Promise<T>): Promise<T> => {
    writes.current += 1;
    return request.finally(() => {
      writes.current -= 1;
      if (writes.current === 0) load();
    });
  };
  const changeAssignees = (next: string[]) => {
    if (detail === null) return;
    const previous = detail.assignees;
    setDetail({ ...detail, assignees: next });
    void tracked(
      rpc.call("setAssignees", { repo, number, assignees: next }),
    ).then(
      () => {},
      (failure: unknown) => {
        setDetail((current) =>
          current === null ? current : { ...current, assignees: previous },
        );
        toast.error(`Couldn't change who's assigned to #${number}`, {
          id: `github-assign-${repo}#${number}`,
          description: errorText(failure),
        });
      },
    );
  };
  const changeLabels = (next: string[]) => {
    if (detail === null) return;
    const previous = detail.labels;
    setDetail({ ...detail, labels: next });
    void tracked(rpc.call("setLabels", { repo, number, labels: next })).then(
      () => {},
      (failure: unknown) => {
        setDetail((current) =>
          current === null ? current : { ...current, labels: previous },
        );
        toast.error(`Couldn't change the labels of #${number}`, {
          id: `github-labels-${repo}#${number}`,
          description: errorText(failure),
        });
      },
    );
  };

  const title = detail === null ? null : splitTitle(detail.title);
  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={HEADER_CLASS}>
        <TipButton
          label="Back"
          keys={["Esc"]}
          icon="ArrowLeft"
          onClick={onBack}
        />
        <span
          className="min-w-0 truncate px-1 text-sm text-subtle-foreground"
          title={`${repo}#${number}`}
        >
          {repo}
        </span>
        <span className="flex-1" />
        <TipButton
          label="Open on GitHub"
          icon="ExternalLink"
          onClick={() => navigate.openUrl(url)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-8 pt-6 pb-14 @max-[35rem]/github:px-4 @max-[35rem]/github:pt-4">
          <div className="flex max-w-180 min-w-0 flex-col gap-6">
            {detail === null || title === null ? (
              error !== null ? (
                <ListMessage
                  icon="CloudOff"
                  title={`Can't load #${number}`}
                  detail={error}
                  action={
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={load}
                    >
                      Try again
                    </Button>
                  }
                />
              ) : (
                <IssueSkeleton title={listed?.title ?? null} number={number} />
              )
            ) : (
              <>
                <header className="flex flex-col gap-2.5">
                  <h1 className="text-lg font-semibold tracking-tight text-pretty text-foreground">
                    {title.prefix === null ? null : (
                      <span className="font-normal text-subtle-foreground">
                        {title.prefix}{" "}
                      </span>
                    )}
                    {title.text}{" "}
                    <span className="font-normal text-subtle-foreground">
                      #{number}
                    </span>
                  </h1>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-subtle-foreground">
                    <IssueStateMenu
                      number={number}
                      open={open}
                      canChange={canEdit}
                      pending={pending}
                      onChange={changeState}
                    />
                    <span className="inline-flex items-center gap-1.5">
                      <PullAuthor login={detail.author} />
                      {authorName(detail.author)}
                    </span>
                    <span>Updated {relativeTime(detail.updatedAt, now)}</span>
                  </div>
                </header>
                <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3">
                  <dt className="flex min-h-8 items-center text-xs text-subtle-foreground max-md:pointer-coarse:min-h-10">
                    Assignees
                  </dt>
                  <dd className="min-w-0">
                    <AssigneePicker
                      repo={repo}
                      assignees={detail.assignees}
                      viewer={viewer}
                      editable={write}
                      onChange={changeAssignees}
                    />
                  </dd>
                  <dt className="flex min-h-8 items-center text-xs text-subtle-foreground max-md:pointer-coarse:min-h-10">
                    Labels
                  </dt>
                  <dd className="min-w-0">
                    <LabelPicker
                      repo={repo}
                      labels={detail.labels}
                      editable={write}
                      onChange={changeLabels}
                    />
                  </dd>
                </dl>
                {agent !== null ? (
                  <AgentLine
                    agent={agent}
                    now={now}
                    inset={false}
                    onOpenThread={() => navigate.toThread(agent.threadId)}
                  />
                ) : open ? (
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={`${COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS} @max-[35rem]/github:w-full`}
                      onClick={() => setAgentTarget(issueAgentTarget(detail))}
                    >
                      <Icon name="Zap" />
                      Start an agent…
                    </Button>
                  </div>
                ) : null}
                <section
                  aria-label="Description"
                  className="flex flex-col gap-1.5"
                >
                  <SectionHeading>Description</SectionHeading>
                  {detail.body.trim().length > 0 ? (
                    <Markdown content={detail.body} className="text-sm" />
                  ) : (
                    <p className="text-sm text-subtle-foreground">
                      No description.
                    </p>
                  )}
                </section>
                <section
                  aria-label="Activity"
                  className="flex flex-col gap-1.5"
                >
                  <SectionHeading>Activity</SectionHeading>
                  <IssueActivity issue={detail} />
                  <CommentBox
                    kind="issue"
                    repo={repo}
                    number={number}
                    onPosted={load}
                  />
                </section>
              </>
            )}
          </div>
        </div>
      </div>
      <AgentSheet
        target={agentTarget}
        onOpenChange={(isOpen) => {
          if (!isOpen) setAgentTarget(null);
        }}
      />
    </div>
  );
}

const issueDraft = { repo: null as string | null, title: "", body: "" };

export function NewIssueForm({
  repos,
  onCreated,
  onCancel,
}: {
  repos: RepoInfo[];
  onCreated: (repo: string, number: number | null) => void;
  onCancel: () => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const [picked, setPicked] = useState<string | null>(() =>
    repos.some((entry) => entry.repo === issueDraft.repo)
      ? issueDraft.repo
      : null,
  );
  const repo = picked ?? repos[0]?.repo ?? "";
  const [title, setTitle] = useState(issueDraft.title);
  const [body, setBody] = useState(issueDraft.body);
  const [creating, setCreating] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const ready = !creating && title.trim().length > 0 && repo.length > 0;
  const create = () => {
    if (!ready) return;
    setCreating(true);
    rpc.call("createIssue", { repo, title: title.trim(), body }).then(
      (result) => {
        issueDraft.repo = null;
        issueDraft.title = "";
        issueDraft.body = "";
        toast.success(
          result.number === null
            ? "Issue created"
            : `Created #${result.number}`,
          { id: "github-new-issue" },
        );
        onCreated(repo, result.number);
      },
      (failure: unknown) => {
        setCreating(false);
        toast.error("Couldn't create the issue", {
          id: "github-new-issue",
          description: errorText(failure),
        });
      },
    );
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={HEADER_CLASS}>
        <TipButton label="Back" icon="ArrowLeft" onClick={onCancel} />
        <span className="min-w-0 truncate px-1 text-sm font-medium text-foreground">
          New issue
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <form
          className="flex max-w-180 min-w-0 flex-col gap-3 px-8 pt-6 pb-14 @max-[35rem]/github:px-4 @max-[35rem]/github:pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.preventDefault();
              onCancel();
            }
          }}
        >
          {repos.length > 1 ? (
            <Select
              value={repo}
              onValueChange={(value) => {
                issueDraft.repo = value;
                setPicked(value);
              }}
            >
              <SelectTrigger aria-label="Repository" className="w-full">
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
          ) : (
            <p className="text-xs text-subtle-foreground">{repo}</p>
          )}
          <Input
            value={title}
            autoFocus
            aria-label="Title"
            placeholder="Title"
            enterKeyHint="next"
            disabled={creating}
            onChange={(event) => {
              issueDraft.title = event.target.value;
              setTitle(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) {
                return;
              }
              event.preventDefault();
              if (event.metaKey || event.ctrlKey) create();
              else bodyRef.current?.focus();
            }}
          />
          <Textarea
            ref={bodyRef}
            value={body}
            rows={8}
            aria-label="Description"
            placeholder="Description (Markdown)"
            disabled={creating}
            onChange={(event) => {
              issueDraft.body = event.target.value;
              setBody(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                create();
              }
            }}
          />
          <div className="flex justify-end gap-2 @max-[35rem]/github:flex-col-reverse">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS}
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className={COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS}
              disabled={!ready}
              aria-keyshortcuts="Meta+Enter Control+Enter"
            >
              {creating ? <SpinnerIcon /> : null}
              {creating ? "Creating…" : "Create issue"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
