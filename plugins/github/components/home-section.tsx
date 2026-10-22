import { useMemo } from "react";
import {
  experimental_Icon as Icon,
  useBbNavigate,
  type ExperimentalBadge,
  type PluginHomepageSectionProps,
} from "@get-bb/plugin-sdk/app";
import { DelayedLoading } from "@/components/ui/delayed-loading";
import { Skeleton } from "@/components/ui/skeleton";
import {
  inboxRows,
  pullRowModels,
  routeToSubPath,
  splitTitle,
  type PullRowModel,
} from "../app-logic.js";
import { useActivities, type Activity } from "./pull-actions.js";
import { FailingAside, rowFailing, rowGlyph, rowReason } from "./pull-list.js";
import {
  AgentGlyph,
  compactAge,
  PANEL_PATH,
  plural,
  PULL_TONE_CLASS,
  useAgents,
  useItems,
  useNow,
  useStatus,
  useViewerState,
  type AgentInfo,
} from "./shared.js";

const HOME_ROWS = 4;

function useInbox(projectId: string | null): {
  rows: PullRowModel[] | null;
  error: string | null;
} {
  const { items, error } = useItems("pr");
  const status = useStatus();
  const { login: viewer, error: viewerError } = useViewerState();
  const rows = useMemo(() => {
    if (items === null || viewer === null) return null;
    const inbox = inboxRows(pullRowModels(items, viewer), viewer);
    if (projectId === null || status === null) return inbox;
    const repos = new Set(
      status.repos
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => entry.repo),
    );
    return repos.size === 0
      ? inbox
      : inbox.filter((row) => repos.has(row.item.repo));
  }, [items, projectId, status, viewer]);
  return { rows, error: error ?? viewerError };
}

export function useInboxBadge(): ExperimentalBadge | null {
  const { rows } = useInbox(null);
  if (rows === null || rows.length === 0) return null;
  return {
    count: rows.length,
    label: `${plural(rows.length, "pull request")} need${rows.length === 1 ? "s" : ""} you`,
  };
}

function HomeRow({
  row,
  activity,
  agent,
  showRepo,
  now,
  onOpen,
}: {
  row: PullRowModel;
  activity: Activity | null;
  agent: AgentInfo | null;
  showRepo: boolean;
  now: number;
  onOpen: () => void;
}) {
  const glyph = rowGlyph(row, activity);
  const reason = rowReason(row, activity, now);
  const { prefix, text } = splitTitle(row.item.title);
  return (
    <button
      type="button"
      onClick={onOpen}
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
        <span className="truncate text-sm font-medium text-foreground max-md:line-clamp-2 max-md:whitespace-normal">
          {prefix === null ? null : (
            <span className="font-normal text-subtle-foreground">
              {prefix}{" "}
            </span>
          )}
          {text}
        </span>
        <span className="flex min-w-0 text-xs text-subtle-foreground">
          <span className="truncate">
            {showRepo ? row.item.repo : ""}#{row.item.number} · {reason}
          </span>
          <FailingAside text={rowFailing(row, activity)} />
        </span>
      </span>
      <span className="flex h-5 shrink-0 items-center gap-2 text-xs text-subtle-foreground tabular-nums">
        {agent === null ? null : (
          <span title={agent.title} className="flex">
            <AgentGlyph agent={agent} />
          </span>
        )}
        {compactAge(row.item.updatedAt, now)}
      </span>
    </button>
  );
}

export function GithubHomeSection({ projectId }: PluginHomepageSectionProps) {
  const navigate = useBbNavigate();
  const { rows, error } = useInbox(projectId);
  const activities = useActivities();
  const agents = useAgents();
  const now = useNow(30_000);
  if (error !== null && rows === null) {
    return (
      <p className="text-xs text-subtle-foreground">
        Can't reach GitHub right now.
      </p>
    );
  }
  if (rows === null) {
    return (
      <DelayedLoading>
        <div aria-hidden className="flex flex-col">
          {[52, 64, 44].map((width) => (
            <div key={width} className="flex items-start gap-2 py-1.5">
              <Skeleton className="mt-0.5 size-4 rounded-full" />
              <span className="flex flex-1 flex-col gap-2 pt-1">
                <Skeleton className="h-3" style={{ width: `${width}%` }} />
                <Skeleton className="h-2.5 w-1/4" />
              </span>
            </div>
          ))}
        </div>
      </DelayedLoading>
    );
  }
  const top = rows.slice(0, HOME_ROWS);
  const more = rows.length - top.length;
  const showRepo = new Set(rows.map((row) => row.item.repo)).size > 1;
  return (
    <div className="flex flex-col">
      {top.length === 0 ? (
        <p className="py-1.5 text-xs text-subtle-foreground">
          Nothing needs you right now.
        </p>
      ) : (
        top.map((row) => (
          <HomeRow
            key={row.key}
            row={row}
            activity={activities.get(row.key) ?? null}
            agent={agents.get(`pr:${row.key}`) ?? null}
            showRepo={showRepo}
            now={now}
            onOpen={() =>
              navigate.toPluginPanel(PANEL_PATH, {
                subPath: routeToSubPath({
                  view: "pull",
                  repo: row.item.repo,
                  number: row.item.number,
                }),
              })
            }
          />
        ))
      )}
      <button
        type="button"
        onClick={() => navigate.toPluginPanel(PANEL_PATH)}
        className="-mx-2 flex h-8 items-center gap-1 self-start rounded-md px-2 text-xs text-subtle-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:h-10"
      >
        {more > 0 ? `${more} more in the inbox` : "Open the inbox"}
        <Icon name="ChevronRight" className="size-3" />
      </button>
    </div>
  );
}
