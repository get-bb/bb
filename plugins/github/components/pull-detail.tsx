import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_ROW_ACTION_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  detailPullStatus,
  splitTitle,
  stateNameOf,
  type PullRowModel,
  type PullStateName,
} from "../app-logic.js";
import {
  mergeBlockedReason,
  pullPreset,
  type PullStatus,
} from "../pull-status.js";
import type { githubRpcContract } from "../server.js";
import type { AgentTarget } from "./agent-sheet.js";
import { Markdown } from "./markdown-lite.js";
import { NextStepCard, NextStepSkeleton } from "./next-step.js";
import {
  copyText,
  settleActivity,
  SnoozeItems,
  useActivities,
  useChangePullState,
  useSnooze,
} from "./pull-actions.js";
import {
  HEADER_CLASS,
  ListMessage,
  TAB_LIST_CLASS,
  TAB_TRIGGER_CLASS,
} from "./pull-list.js";
import {
  BranchCopyChip,
  PullDiffStat,
  PullStateMenu,
  type PullStateSubject,
} from "./pull-state.js";
import {
  ActivitySkeleton,
  ActivityTimeline,
  ChecksSkeleton,
  ChecksTab,
  CommentBox,
  FilesSkeleton,
  FilesTab,
  SectionError,
  type DetailTab,
} from "./pull-tabs.js";
import {
  authorName,
  errorText,
  itemKey,
  plural,
  PullAuthor,
  SectionHeading,
  TEXT_BUTTON_CLASS,
  TipButton,
  TriggerTip,
  useAgents,
  useNow,
  useRepoSettings,
  type PullDetail,
} from "./shared.js";

export type DetailRequestKind =
  | "merge"
  | "agent"
  | "ready"
  | "status"
  | "snooze"
  | "thread"
  | "copy"
  | "open";

export interface PullDetailHandle {
  run: (kind: DetailRequestKind) => void;
}

export type DetailLayout = "split" | "panel";

const detailCache = new Map<string, PullDetail>();
const DETAIL_CACHE_SIZE = 24;
const CHECKS_POLL_MS = 20_000;

function rememberDetail(key: string, pull: PullDetail): void {
  detailCache.delete(key);
  detailCache.set(key, pull);
  const oldest = detailCache.keys().next().value;
  if (detailCache.size > DETAIL_CACHE_SIZE && oldest !== undefined) {
    detailCache.delete(oldest);
  }
}

function useDetail(repo: string, number: number) {
  const rpc = useRpc<typeof githubRpcContract>();
  const key = `${repo}#${number}`;
  const [pull, setPull] = useState<PullDetail | null>(
    () => detailCache.get(key) ?? null,
  );
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    seq.current += 1;
    const current = seq.current;
    rpc.call("getPull", { repo, number }).then(
      (result) => {
        rememberDetail(`${repo}#${number}`, result.pull);
        if (current !== seq.current) return;
        setPull(result.pull);
        setFresh(true);
        setError(null);
      },
      (failure: unknown) => {
        if (current === seq.current) setError(errorText(failure));
      },
    );
  }, [rpc, repo, number]);
  useEffect(() => {
    load();
  }, [load]);
  useRealtime("data-changed", load);
  const checksRunning =
    pull !== null &&
    pull.state !== "MERGED" &&
    pull.state !== "CLOSED" &&
    pull.checks.some((check) => check.status === "pending");
  useEffect(() => {
    if (!checksRunning) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, CHECKS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [checksRunning, load]);
  return { pull, fresh, error, load };
}

function pullStateName(pull: PullDetail): PullStateName {
  if (pull.state === "MERGED" || pull.state === "CLOSED") return pull.state;
  return pull.isDraft ? "DRAFT" : "OPEN";
}

interface StackNode {
  number: number;
  title: string;
  label: ReactNode;
}

function StackSection({
  current,
  nodes,
  base,
  onOpen,
}: {
  current: number;
  nodes: StackNode[];
  base: string;
  onOpen: (number: number) => void;
}) {
  const at = nodes.findIndex((node) => node.number === current);
  return (
    <section aria-label="Stack" className="flex flex-col gap-1.5">
      <SectionHeading>
        Stack
        <span className="font-normal tabular-nums">
          {at + 1} of {nodes.length}
        </span>
      </SectionHeading>
      <ol className="flex flex-col">
        {[...nodes].reverse().map((node) => {
          const here = node.number === current;
          return (
            <li key={node.number}>
              <button
                type="button"
                aria-current={here ? "true" : undefined}
                onClick={() => onOpen(node.number)}
                className={`relative -mx-2 flex h-8 w-[calc(100%+1rem)] items-center gap-2 rounded-md pr-2 pl-8 text-left text-sm before:absolute before:top-0 before:bottom-0 before:left-[15.5px] before:w-px before:bg-input first:before:top-1/2 max-md:pointer-coarse:h-10 ${here ? "bg-state-active" : "hover:bg-state-hover"}`}
              >
                <span
                  className={`absolute top-1/2 left-3 size-2 -translate-y-1/2 rounded-full border ${here ? "border-foreground bg-foreground" : "border-input bg-background"}`}
                />
                <span className="w-10 shrink-0 text-xs text-subtle-foreground tabular-nums">
                  #{node.number}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {splitTitle(node.title).text}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-subtle-foreground">
                  {here ? null : node.label}
                </span>
              </button>
            </li>
          );
        })}
        <li className="relative -mx-2 flex h-8 items-center gap-2 pr-2 pl-8 before:absolute before:top-0 before:bottom-1/2 before:left-[15.5px] before:w-px before:bg-input">
          <span className="absolute top-1/2 left-3 size-2 -translate-y-1/2 rounded-sm border border-input bg-background" />
          <span className="flex w-10 shrink-0 items-center">
            <Icon name="GitBranch" className="size-3.5 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-subtle-foreground">
            {base}
          </span>
        </li>
      </ol>
    </section>
  );
}

function stackLabel(state: string, attention: string): ReactNode {
  if (attention === "conflicts") return "Conflicts";
  if (attention === "checks_failed") return "Checks failing";
  if (state === "draft") return "Draft";
  if (state === "merged") return "Merged";
  if (attention === "ready_to_merge") return "Ready to merge";
  return null;
}

function Description({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element !== null) setOverflows(element.scrollHeight > 160);
  }, [body]);
  if (body.trim().length === 0) return null;
  return (
    <section aria-label="Description" className="flex flex-col gap-1.5">
      <SectionHeading>Description</SectionHeading>
      <div
        ref={ref}
        className={
          open || !overflows
            ? "min-w-0"
            : "max-h-40 min-w-0 overflow-hidden [mask-image:linear-gradient(180deg,black_50%,transparent)]"
        }
      >
        <Markdown content={body} className="text-sm" />
      </div>
      {overflows ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={`-ml-2 ${TEXT_BUTTON_CLASS}`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Show less" : "Show more"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function SnoozeMenu({
  number,
  snoozed,
  openRequest,
  onSnooze,
  onUnsnooze,
}: {
  number: number;
  snoozed: boolean;
  openRequest: number;
  onSnooze: Parameters<typeof SnoozeItems>[0]["onSnooze"];
  onUnsnooze: () => void;
}) {
  const compact = useIsCompactViewport();
  const [open, setOpen] = useState(false);
  const [seenRequest, setSeenRequest] = useState(openRequest);
  if (seenRequest !== openRequest) {
    setSeenRequest(openRequest);
    setOpen(true);
  }
  const label = snoozed ? "Snoozed" : "Snooze";
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <TriggerTip label={label} keys={["Z"]}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={label}
            className={`${COARSE_POINTER_ROW_ACTION_SIZE_CLASS} hover:text-foreground data-[state=open]:bg-state-active ${snoozed ? "text-foreground" : "text-muted-foreground"}`}
          >
            <Icon name="TimeSchedule" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      </TriggerTip>
      <DropdownMenuContent
        align="end"
        className="w-56"
        mobileTitle={`Snooze #${number}`}
      >
        <DropdownMenuLabel aria-hidden={compact || undefined}>
          Snooze #{number}
        </DropdownMenuLabel>
        <SnoozeItems
          snoozed={snoozed}
          onSnooze={onSnooze}
          onUnsnooze={onUnsnooze}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeaderSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-2.5">
      <Skeleton className="h-4.5 w-4/5" />
      <Skeleton className="h-4.5 w-1/2" />
      <div className="flex items-center gap-3 pt-0.5">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-2.5 w-2/5" />
      </div>
    </div>
  );
}

export function PullDetailView({
  repo,
  number,
  row,
  chain,
  viewer,
  layout,
  environmentId,
  handle,
  pendingRequest,
  onBack,
  onClose,
  onOpenPull,
  onStartAgent,
}: {
  repo: string;
  number: number;
  row: PullRowModel | null;
  chain: PullRowModel[] | null;
  viewer: string | null;
  layout: DetailLayout;
  environmentId: string | null;
  handle: React.Ref<PullDetailHandle> | null;
  pendingRequest: DetailRequestKind | null;
  onBack: (() => void) | null;
  onClose: (() => void) | null;
  onOpenPull: (repo: string, number: number) => void;
  onStartAgent: (target: AgentTarget) => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const navigate = useBbNavigate();
  const key = itemKey({ repo, number });
  const { pull, fresh, error, load } = useDetail(repo, number);
  const agent = useAgents().get(`pr:${key}`) ?? null;
  const settings = useRepoSettings();
  const activity = useActivities().get(key) ?? null;
  const changeState = useChangePullState();
  const { snooze, unsnooze } = useSnooze();
  const now = useNow(30_000);
  const [tab, setTab] = useState<DetailTab>("activity");
  const [rerunning, setRerunning] = useState(false);
  const [mergeMenuOpen, setMergeMenuOpen] = useState(false);
  const [statusRequest, setStatusRequest] = useState(0);
  const [snoozeRequest, setSnoozeRequest] = useState(0);
  const tabsRef = useRef<HTMLDivElement>(null);

  const status: PullStatus | null =
    pull !== null ? detailPullStatus(pull) : (row?.pr ?? null);
  const title = pull?.title ?? row?.item.title ?? null;
  const author = pull?.author ?? row?.item.author ?? null;
  const headRefName = pull?.headRefName ?? row?.pr.headRefName ?? null;
  const baseRefName = pull?.baseRefName ?? row?.pr.baseRefName ?? null;
  const url =
    pull?.url ?? row?.item.url ?? `https://github.com/${repo}/pull/${number}`;
  const live =
    status !== null && (status.state === "open" || status.state === "draft");
  const [seenPending, setSeenPending] = useState<DetailRequestKind | null>(
    null,
  );
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  if (
    pendingRequest !== seenPending &&
    fresh &&
    pull !== null &&
    status !== null
  ) {
    setSeenPending(pendingRequest);
    if (pendingRequest === "merge" && live) {
      const blocked = pull.viewerCanMerge
        ? mergeBlockedReason(status, pull.mergeStateStatus)
        : `You can't merge in ${repo}`;
      if (blocked === null) setMergeMenuOpen(true);
      else setMergeNotice(blocked);
    }
  }
  useEffect(() => {
    if (mergeNotice === null) return;
    toast(`#${number} can't be merged yet`, {
      id: `github-merge-${repo}#${number}`,
      description: mergeNotice,
    });
  }, [mergeNotice, number, repo]);
  const dataState: PullStateName =
    pull !== null
      ? pullStateName(pull)
      : row !== null
        ? stateNameOf(row.pr)
        : "OPEN";
  const stateName =
    activity?.kind === "changed"
      ? activity.state
      : activity?.kind === "merged"
        ? "MERGED"
        : dataState;
  const subject: PullStateSubject = {
    number,
    state: stateName,
    isDraft:
      stateName === "DRAFT" ||
      (stateName !== "OPEN" && (pull?.isDraft ?? row?.pr.state === "draft")),
    viewerCanUpdate: pull?.viewerCanUpdate ?? false,
    viewerCanClose:
      (pull?.viewerCanClose ?? false) ||
      ((stateName === "OPEN" || stateName === "DRAFT") &&
        (pull?.viewerCanReopen ?? false)),
    viewerCanReopen:
      (pull?.viewerCanReopen ?? false) ||
      (stateName === "CLOSED" && (pull?.viewerCanClose ?? false)),
  };
  const pending = activity?.kind === "changing" ? activity.label : null;
  const snoozed = row?.item.snooze ?? null;

  const change = useCallback(
    (target: Parameters<typeof changeState>[1]) => {
      void changeState({ repo, number, state: stateName }, target).then(
        (changed) => {
          if (changed) load();
        },
      );
    },
    [changeState, load, number, repo, stateName],
  );
  useEffect(() => {
    if (pull !== null) settleActivity(key, pullStateName(pull));
  }, [key, pull]);
  const startAgent = useCallback(() => {
    if (status === null || headRefName === null || baseRefName === null) {
      return;
    }
    onStartAgent({
      kind: "pr",
      repo,
      number,
      title: title ?? `#${number}`,
      headRefName,
      baseRefName,
      isCrossRepository:
        pull?.isCrossRepository ?? row?.pr.isCrossRepository ?? false,
      preset: pullPreset(status, author ?? "", viewer),
    });
  }, [
    author,
    baseRefName,
    headRefName,
    number,
    onStartAgent,
    pull?.isCrossRepository,
    repo,
    row?.pr.isCrossRepository,
    status,
    title,
    viewer,
  ]);
  const openThread = useCallback(() => {
    if (agent === null) {
      toast(`No agent works on #${number} yet`, { id: `github-thread-${key}` });
      return;
    }
    navigate.toThread(agent.threadId);
  }, [agent, key, navigate, number]);
  const rerun = useCallback(() => {
    setRerunning(true);
    rpc
      .call("rerunFailedChecks", { repo, number })
      .then(
        (result) => {
          toast.success(
            `Re-running ${plural(result.checks, "failed check")} on #${number}`,
            { id: `github-rerun-${key}` },
          );
          load();
        },
        (failure: unknown) =>
          toast.error(`Couldn't re-run the checks on #${number}`, {
            id: `github-rerun-${key}`,
            description: errorText(failure),
          }),
      )
      .finally(() => setRerunning(false));
  }, [key, load, number, repo, rpc]);
  const showFiles = useCallback(() => {
    setTab("files");
    tabsRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, []);

  const run = (kind: DetailRequestKind) => {
    switch (kind) {
      case "merge": {
        if (pull === null || status === null || !live) return;
        const blocked = pull.viewerCanMerge
          ? mergeBlockedReason(status, pull.mergeStateStatus)
          : `You can't merge in ${repo}`;
        if (blocked === null) setMergeMenuOpen(true);
        else {
          toast(`#${number} can't be merged yet`, {
            id: `github-merge-${key}`,
            description: blocked,
          });
        }
        return;
      }
      case "agent":
        if (live) startAgent();
        return;
      case "ready":
        if (subject.state === "DRAFT" && subject.viewerCanUpdate) {
          change("open");
        }
        return;
      case "status":
        setStatusRequest((value) => value + 1);
        return;
      case "snooze":
        if (live) setSnoozeRequest((value) => value + 1);
        return;
      case "thread":
        openThread();
        return;
      case "copy":
        if (headRefName !== null) copyText(headRefName, "branch name");
        return;
      case "open":
        navigate.openUrl(url);
        return;
    }
  };
  useImperativeHandle(handle, () => ({ run }));

  const nativeStack =
    pull?.stack != null && pull.stack.entries.length > 1 ? pull.stack : null;
  const stackNodes: StackNode[] | null =
    nativeStack !== null
      ? nativeStack.entries.map((entry) => ({
          number: entry.number,
          title: entry.title,
          label: stackLabel(entry.state, entry.attention),
        }))
      : chain !== null && chain.length > 1
        ? chain.map((entry) => ({
            number: entry.item.number,
            title: entry.item.title,
            label: stackLabel(entry.pr.state, entry.pr.attention),
          }))
        : null;
  const stackBase =
    nativeStack?.baseRefName ?? chain?.[0]?.pr.baseRefName ?? baseRefName ?? "";
  const filesCount = pull?.changedFiles ?? row?.pr.changedFiles ?? null;
  const padding =
    layout === "panel"
      ? "px-4 pt-4 pb-10"
      : "px-8 pt-6 pb-14 @max-[35rem]/github:px-4 @max-[35rem]/github:pt-4";
  const tabSkeleton =
    tab === "files" ? (
      <FilesSkeleton count={filesCount ?? 4} />
    ) : tab === "checks" ? (
      <ChecksSkeleton />
    ) : (
      <ActivitySkeleton />
    );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={HEADER_CLASS}>
        {onBack === null ? null : (
          <span
            className={
              layout === "split" ? "flex @min-[60rem]/github:hidden" : "flex"
            }
          >
            <TipButton
              label="Back"
              keys={["Esc"]}
              icon="ArrowLeft"
              onClick={onBack}
            />
          </span>
        )}
        <span
          className="min-w-0 truncate px-1 text-sm text-subtle-foreground"
          title={`${repo}#${number}`}
        >
          {repo}
        </span>
        <span className="flex-1" />
        {live ? (
          <SnoozeMenu
            number={number}
            snoozed={snoozed !== null}
            openRequest={snoozeRequest}
            onSnooze={(choice) => snooze({ repo, number }, choice)}
            onUnsnooze={() => unsnooze({ repo, number })}
          />
        ) : null}
        <TipButton
          label="Open on GitHub"
          keys={["O"]}
          icon="ExternalLink"
          onClick={() => navigate.openUrl(url)}
        />
        {layout === "split" && onClose !== null ? (
          <span className="hidden @min-[60rem]/github:flex">
            <TipButton
              label="Close"
              keys={["Esc"]}
              icon="X"
              onClick={onClose}
            />
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={padding}>
          <div className="flex max-w-180 min-w-0 flex-col gap-6">
            {title === null ? (
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
                <DelayedLoading>
                  <div className="flex flex-col gap-6">
                    <HeaderSkeleton />
                    <NextStepSkeleton />
                    <ActivitySkeleton />
                  </div>
                </DelayedLoading>
              )
            ) : (
              <>
                <header className="flex flex-col gap-2.5">
                  <h1
                    className={`font-semibold tracking-tight text-pretty text-foreground ${layout === "panel" ? "text-base" : "text-lg"}`}
                  >
                    {(() => {
                      const parts = splitTitle(title);
                      return (
                        <>
                          {parts.prefix === null ? null : (
                            <span className="font-normal text-subtle-foreground">
                              {parts.prefix}{" "}
                            </span>
                          )}
                          {parts.text}{" "}
                          <span className="font-normal text-subtle-foreground">
                            #{number}
                          </span>
                        </>
                      );
                    })()}
                  </h1>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-subtle-foreground">
                    <PullStateMenu
                      subject={subject}
                      pending={pending}
                      openRequest={statusRequest}
                      onChange={change}
                    />
                    {author === null ? null : (
                      <span className="inline-flex items-center gap-1.5">
                        <PullAuthor login={author} />
                        {authorName(author)}
                      </span>
                    )}
                    {pull === null && row === null ? null : (
                      <PullDiffStat
                        additions={pull?.additions ?? row?.pr.additions ?? 0}
                        deletions={pull?.deletions ?? row?.pr.deletions ?? 0}
                        changedFiles={filesCount ?? 0}
                        onShowFiles={showFiles}
                      />
                    )}
                    {headRefName === null || baseRefName === null ? null : (
                      <span className="flex min-w-0 flex-[1_1_10rem] items-center gap-1">
                        <BranchCopyChip name={headRefName} />
                        <span className="shrink-0 font-mono">
                          → {baseRefName}
                        </span>
                      </span>
                    )}
                  </div>
                </header>
                {pull === null || status === null ? (
                  error !== null ? (
                    <SectionError
                      message="Couldn't load the pull request"
                      onRetry={load}
                    />
                  ) : (
                    <NextStepSkeleton
                      status={status}
                      viewer={viewer}
                      agent={live ? agent : null}
                      canMerge={settings?.[repo]?.viewerCanWrite ?? true}
                    />
                  )
                ) : (
                  <NextStepCard
                    pull={pull}
                    status={status}
                    viewer={viewer}
                    activity={activity}
                    agent={live ? agent : null}
                    now={now}
                    rerunning={rerunning}
                    mergeMenuOpen={mergeMenuOpen}
                    handlers={{
                      onMergeMenuOpenChange: setMergeMenuOpen,
                      onShowChecks: () => {
                        setTab("checks");
                        tabsRef.current?.scrollIntoView?.({
                          block: "start",
                          behavior: "smooth",
                        });
                      },
                      onRerun: rerun,
                      onReady: () => change("open"),
                      onReopen: () => change(pull.isDraft ? "draft" : "open"),
                      onStartAgent: startAgent,
                      onOpenThread: openThread,
                    }}
                  />
                )}
                {live && stackNodes !== null ? (
                  <StackSection
                    current={number}
                    nodes={stackNodes}
                    base={stackBase}
                    onOpen={(target) => onOpenPull(repo, target)}
                  />
                ) : null}
                <Description body={pull?.body ?? row?.item.body ?? ""} />
                <Tabs
                  ref={tabsRef}
                  value={tab}
                  onValueChange={(value) => setTab(value as DetailTab)}
                  className="scroll-mt-4"
                >
                  <TabsList
                    aria-label="Pull request"
                    className={`${TAB_LIST_CLASS} -ml-2 flex`}
                  >
                    <TabsTrigger value="activity" className={TAB_TRIGGER_CLASS}>
                      Activity
                    </TabsTrigger>
                    <TabsTrigger value="files" className={TAB_TRIGGER_CLASS}>
                      Files
                      {filesCount === null ? null : (
                        <span className="text-xs font-normal tabular-nums">
                          {filesCount}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="checks" className={TAB_TRIGGER_CLASS}>
                      Checks
                      {pull === null ? null : (
                        <span className="text-xs font-normal tabular-nums">
                          {pull.checks.length}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>
                  {(["activity", "files", "checks"] as const).map((value) => (
                    <TabsContent key={value} value={value} className="mt-3">
                      {pull === null ? (
                        error !== null ? null : (
                          tabSkeleton
                        )
                      ) : value === "files" ? (
                        <FilesTab pull={pull} environmentId={environmentId} />
                      ) : value === "checks" ? (
                        <ChecksTab
                          pull={pull}
                          rerunning={rerunning}
                          onRerun={
                            live && status?.attention !== "checks_failed"
                              ? rerun
                              : null
                          }
                        />
                      ) : (
                        <>
                          <ActivityTimeline pull={pull} />
                          <CommentBox
                            kind="pr"
                            repo={repo}
                            number={number}
                            onPosted={load}
                          />
                        </>
                      )}
                    </TabsContent>
                  ))}
                </Tabs>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
