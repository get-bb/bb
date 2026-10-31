import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useBbNavigate,
  useRpc,
  type PluginCommandRegistration,
  type PluginNavPanelProps,
  type ExperimentalThreadActionTabProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import { Skeleton } from "@/components/ui/skeleton";
import {
  parseSubPath,
  pullRowModels,
  routeToSubPath,
  splitTitle,
  type PullRowModel,
  type Route,
} from "./app-logic.js";
import type { githubRpcContract } from "./server.js";
import { AgentSheet, type AgentTarget } from "./components/agent-sheet.js";
import { GithubHomeSection, useInboxBadge } from "./components/home-section.js";
import { IssueDetailView, NewIssueForm } from "./components/issues.js";
import { PullDetailView } from "./components/pull-detail.js";
import { ListMessage, rowGlyph } from "./components/pull-list.js";
import {
  errorText,
  PANEL_PATH,
  PULL_TONE_CLASS,
  relativeTime,
  TipButton,
  useItems,
  useStatus,
  useSync,
  useViewer,
  type Status,
} from "./components/shared.js";
import { PullWorkspace, type PanelNavigator } from "./components/workspace.js";

function usePanelNavigator(): PanelNavigator {
  const bbNavigate = useBbNavigate();
  const backTo = useRef<string | null>(null);
  return useMemo(
    () => ({
      go(route: Route, options?: { replace?: boolean }) {
        const replace = options?.replace === true;
        const deeper =
          route.view === "pull" ||
          route.view === "issue" ||
          route.view === "new";
        if (!replace) backTo.current = deeper ? window.location.href : null;
        bbNavigate.toPluginPanel(PANEL_PATH, {
          subPath: routeToSubPath(route),
          ...(replace ? { replace: true } : {}),
        });
      },
      back(fallback: Route) {
        const from = backTo.current;
        backTo.current = null;
        if (from !== null && from !== window.location.href) {
          window.history.back();
          return;
        }
        bbNavigate.toPluginPanel(PANEL_PATH, {
          subPath: routeToSubPath(fallback),
          replace: true,
        });
      },
    }),
    [bbNavigate],
  );
}

function PanelHeader() {
  const status = useStatus();
  const sync = useSync();
  const label = sync.syncing
    ? "Syncing…"
    : status?.lastSyncedAt == null
      ? "Refresh"
      : `Refresh · Synced ${relativeTime(status.lastSyncedAt)}`;
  return (
    <TipButton
      label={label}
      icon="RotateCcw"
      busy={sync.syncing}
      onClick={sync.refresh}
    />
  );
}

function SetupMessage({ status }: { status: Status }) {
  const [title, detail] = !status.ghOk
    ? [
        "Connect the GitHub CLI",
        <>
          Install it from cli.github.com, run <code>gh auth login</code>, then
          reload the plugin. {status.ghError ?? ""}
        </>,
      ]
    : [
        "No GitHub repositories tracked yet",
        "Create a bb project whose checkout has a GitHub origin remote, or add repositories in the extraRepos plugin setting.",
      ];
  return <ListMessage icon="Github" title={title} detail={detail} />;
}

function GithubPanel({ subPath }: PluginNavPanelProps) {
  const route = useMemo(() => parseSubPath(subPath), [subPath]);
  const navigator = usePanelNavigator();
  const status = useStatus();
  let body: ReactNode;
  if (
    status !== null &&
    ((status.ghState !== "unavailable" && !status.ghOk) ||
      status.repos.length === 0)
  ) {
    body = <SetupMessage status={status} />;
  } else if (route.view === "issue") {
    body = (
      <IssueDetailView
        key={`${route.repo}#${route.number}`}
        repo={route.repo}
        number={route.number}
        onBack={() => navigator.back({ view: "issues" })}
      />
    );
  } else if (route.view === "new") {
    body = (
      <NewIssueForm
        repos={status?.repos ?? []}
        onCreated={(repo, number) =>
          navigator.go(
            number === null
              ? { view: "issues" }
              : { view: "issue", repo, number },
            { replace: true },
          )
        }
        onCancel={() => navigator.back({ view: "issues" })}
      />
    );
  } else {
    body = (
      <PullWorkspace route={route} navigator={navigator} status={status} />
    );
  }
  return (
    <div className="@container/github flex min-h-0 flex-1 flex-col">{body}</div>
  );
}

function PanelSkeleton() {
  return (
    <DelayedLoading>
      <div aria-hidden className="flex flex-col gap-2.5">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-2 h-24 w-full rounded-lg" />
      </div>
    </DelayedLoading>
  );
}

function PullPicker({
  intro,
  onPick,
}: {
  intro: string;
  onPick: (repo: string, number: number) => void;
}) {
  const viewer = useViewer();
  const { items, error, refetch } = useItems("pr");
  const rows = useMemo(() => {
    if (items === null) return null;
    const me = viewer?.toLowerCase() ?? null;
    return pullRowModels(items, viewer)
      .filter((row) => row.pr.state === "open" || row.pr.state === "draft")
      .sort(
        (a, b) =>
          Number(b.item.author.toLowerCase() === me) -
            Number(a.item.author.toLowerCase() === me) ||
          b.item.updatedAt.localeCompare(a.item.updatedAt),
      );
  }, [items, viewer]);
  if (error !== null && rows === null) {
    return (
      <ListMessage
        icon="CloudOff"
        title="Can't reach GitHub"
        detail={error}
        action={
          <Button type="button" size="sm" variant="ghost" onClick={refetch}>
            Try again
          </Button>
        }
      />
    );
  }
  if (rows === null) return <PanelSkeleton />;
  if (rows.length === 0) {
    return (
      <ListMessage
        icon="GitPullRequest"
        title="No open pull requests"
        detail="Pull requests in the tracked repositories show up here."
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-subtle-foreground">{intro}</p>
      <div className="flex flex-col">
        {rows.map((row) => (
          <PickerRow
            key={row.key}
            row={row}
            onPick={() => onPick(row.item.repo, row.item.number)}
          />
        ))}
      </div>
    </div>
  );
}

function PickerRow({ row, onPick }: { row: PullRowModel; onPick: () => void }) {
  const glyph = rowGlyph(row, null);
  return (
    <button
      type="button"
      onClick={onPick}
      className="-mx-2 flex items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:py-2.5"
    >
      <span
        title={glyph.label}
        className="mt-0.5 flex size-4 shrink-0 items-center justify-center"
      >
        <Icon
          name={glyph.icon}
          aria-hidden
          className={`size-4 ${PULL_TONE_CLASS[glyph.tone]}`}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">
          {splitTitle(row.item.title).text}
        </span>
        <span className="truncate text-xs text-subtle-foreground">
          {row.item.repo}#{row.item.number}
        </span>
      </span>
    </button>
  );
}

interface PanelPull {
  repo: string;
  number: number;
  environmentId: string | null;
}

function PullPanelTab({ threadId }: ExperimentalThreadActionTabProps) {
  return <PullPanelBody key={threadId} threadId={threadId} />;
}

function PullPanelBody({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof githubRpcContract>();
  const viewer = useViewer();
  const { items } = useItems("pr");
  const [lookup, setLookup] = useState<{
    attempt: number;
    resolved: boolean;
    linked: boolean;
    error: string | null;
  }>({ attempt: 0, resolved: false, linked: false, error: null });
  const [selected, setSelected] = useState<PanelPull | null>(null);
  const [agentTarget, setAgentTarget] = useState<AgentTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.call("pullForThread", { threadId }).then(
      (result) => {
        if (cancelled) return;
        setSelected(result.pull);
        setLookup((current) => ({
          ...current,
          resolved: true,
          linked: result.pull !== null,
          error: null,
        }));
      },
      (failure: unknown) => {
        if (cancelled) return;
        setLookup((current) => ({
          ...current,
          resolved: true,
          error: errorText(failure),
        }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [lookup.attempt, rpc, threadId]);

  if (!lookup.resolved) return <PanelSkeleton />;
  if (selected === null) {
    if (lookup.error !== null) {
      return (
        <ListMessage
          icon="CloudOff"
          title="Can't reach GitHub"
          detail={lookup.error}
          action={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                setLookup((current) => ({
                  attempt: current.attempt + 1,
                  resolved: false,
                  linked: false,
                  error: null,
                }))
              }
            >
              Try again
            </Button>
          }
        />
      );
    }
    return (
      <PullPicker
        intro={
          lookup.linked
            ? "Pick a pull request to show here."
            : "No pull request is linked to this thread. Pick one to show it here."
        }
        onPick={(repo, number) =>
          setSelected({ repo, number, environmentId: null })
        }
      />
    );
  }
  const item =
    items?.find(
      (entry) =>
        entry.repo === selected.repo && entry.number === selected.number,
    ) ?? null;
  const row = item === null ? null : (pullRowModels([item], viewer)[0] ?? null);
  return (
    <div className="-m-4 flex min-h-0 flex-1 flex-col @container/github">
      <PullDetailView
        key={`${selected.repo}#${selected.number}`}
        repo={selected.repo}
        number={selected.number}
        row={row}
        chain={null}
        viewer={viewer}
        layout="panel"
        environmentId={selected.environmentId}
        handle={null}
        pendingRequest={null}
        onBack={() => setSelected(null)}
        onClose={null}
        onOpenPull={(repo, number) =>
          setSelected({ repo, number, environmentId: null })
        }
        onStartAgent={setAgentTarget}
      />
      <AgentSheet
        target={agentTarget}
        onOpenChange={(open) => {
          if (!open) setAgentTarget(null);
        }}
      />
    </div>
  );
}

export const THREAD_PULL_COMMAND: PluginCommandRegistration = {
  id: "thread-pull",
  title: "GitHub: Open this thread's pull request",
  isAvailable: (context) => context.threadId !== null,
  run: (context) => {
    context.experimental_panel.openTab({
      tab: { id: "pull", context: { kind: "thread" }, availability: "action" },
    });
  },
};

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "github",
    title: "GitHub",
    icon: "Github",
    path: PANEL_PATH,
    component: GithubPanel,
    headerContent: PanelHeader,
    experimental_useBadge: useInboxBadge,
  });
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "pull",
    title: "GitHub",
    icon: "Github",
    component: PullPanelTab,
  });
  app.slots.homepageSection({
    id: "inbox",
    title: "GitHub",
    component: GithubHomeSection,
  });
  app.commands.register(THREAD_PULL_COMMAND);
});
