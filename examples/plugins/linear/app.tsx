// bb-plugin-linear — the frontend bundle (built by `bb plugin build` /
// install-time, served by the BB server, loaded by the BB app).
//
// React and @bb/plugin-sdk/app resolve to the host's shared runtime at load
// time (never bundled), so this file must be loaded by BB, not imported
// directly. Styling is Tailwind against the host's theme tokens only.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  Markdown,
  Spinner,
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@bb/plugin-sdk/app";
import type {
  PluginHomepageSectionProps,
  PluginThreadPanelTabProps,
} from "@bb/plugin-sdk/app";

interface Issue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  state: string;
  updatedAt: string;
}

function parseIssues(result: unknown): Issue[] {
  const issues = (result as { issues?: unknown })?.issues;
  return Array.isArray(issues) ? (issues as Issue[]) : [];
}

// ---------------------------------------------------------------------------
// Linked-thread cache for the synchronous threadPanelTab visible() predicate.
//
// visible() runs synchronously per render, but "is this thread linked to an
// issue?" lives server-side. So the module keeps a tiny cache of linked
// thread ids: primed once when the bundle loads, refreshed on the backend's
// "issues-updated" signal and after every startWork. visible() just reads it
// (false until loaded) — no dead tab on unrelated threads, no async in the
// predicate. See the README for why this is the canonical pattern.
// ---------------------------------------------------------------------------

let linkedThreadIds: Set<string> | null = null;

async function refreshLinkCache(): Promise<void> {
  try {
    const response = await fetch("/api/v1/plugins/linear/rpc/listLinks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    const body = (await response.json()) as {
      ok?: unknown;
      result?: { threadIds?: unknown };
    };
    if (body.ok === true && Array.isArray(body.result?.threadIds)) {
      linkedThreadIds = new Set(
        body.result.threadIds.filter((id): id is string => typeof id === "string"),
      );
    }
  } catch {
    // Keep the previous cache; the next signal retries.
  }
}

// Prime at bundle load — browser only (the bundle is also evaluated by
// node-side tests, where a relative fetch has no origin).
if (typeof document !== "undefined") {
  void refreshLinkCache();
}

/** Shared data plane: cached issues + refetch on the backend's signal. */
function useIssues(): {
  issues: Issue[] | null;
  error: string | null;
} {
  const rpc = useRpc();
  const [state, setState] = useState<{
    issues: Issue[] | null;
    error: string | null;
  }>({ issues: null, error: null });
  const refetch = useCallback(() => {
    rpc.call("listIssues").then(
      (result) => setState({ issues: parseIssues(result), error: null }),
      (error: unknown) =>
        setState({
          issues: null,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  }, [rpc]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  useRealtime("issues-updated", () => {
    void refreshLinkCache();
    refetch();
  });
  return state;
}

/** Kicks off work on an issue: rpc startWork → navigate to the new thread. */
function useStartWork(projectId: string | null): {
  startWork: (issueId: string) => void;
  startingId: string | null;
  startError: string | null;
} {
  const rpc = useRpc();
  const navigate = useBbNavigate();
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const startWork = useCallback(
    (issueId: string) => {
      setStartingId(issueId);
      setStartError(null);
      rpc
        .call("startWork", {
          issueId,
          ...(projectId !== null ? { projectId } : {}),
        })
        .then((result) => {
          const threadId = (result as { threadId?: unknown })?.threadId;
          if (typeof threadId !== "string") {
            throw new Error("malformed startWork result");
          }
          // The new thread is linked now — make the Issue tab visible
          // immediately, before the next listLinks round-trip.
          (linkedThreadIds ??= new Set()).add(threadId);
          navigate.toThread(threadId);
        })
        .catch((error: unknown) => {
          setStartError(
            error instanceof Error ? error.message : String(error),
          );
        })
        .finally(() => setStartingId(null));
    },
    [rpc, navigate, projectId],
  );
  return { startWork, startingId, startError };
}

const EMPTY_HINT =
  "No open Linear issues cached yet. Configure your Linear API key under " +
  "Settings → Plugins, then run `bb linear sync` (or wait for the 5-minute sync).";

function OpenIssuesSection({ projectId }: PluginHomepageSectionProps) {
  const { issues, error } = useIssues();
  const { startWork, startingId, startError } = useStartWork(projectId);

  if (error !== null) {
    return <EmptyState message={error} />;
  }
  if (issues === null) {
    return (
      <div className="flex justify-center py-4">
        <Spinner />
      </div>
    );
  }
  if (issues.length === 0) {
    return <EmptyState message={EMPTY_HINT} />;
  }
  return (
    <div className="flex flex-col gap-1">
      {startError !== null ? (
        <p className="text-sm text-destructive">{startError}</p>
      ) : null}
      {issues.slice(0, 8).map((issue) => (
        <div
          key={issue.id}
          className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
        >
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {issue.identifier}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {issue.title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {issue.state}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={startingId !== null}
            onClick={() => startWork(issue.id)}
          >
            {startingId === issue.id ? "Starting…" : "Start work"}
          </Button>
        </div>
      ))}
    </div>
  );
}

function Board() {
  const { issues, error } = useIssues();

  const columns = useMemo(() => {
    const byState = new Map<string, Issue[]>();
    for (const issue of issues ?? []) {
      const bucket = byState.get(issue.state);
      if (bucket === undefined) {
        byState.set(issue.state, [issue]);
      } else {
        bucket.push(issue);
      }
    }
    return [...byState.entries()];
  }, [issues]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      <h2 className="text-sm font-semibold text-foreground">Linear board</h2>
      {error !== null ? (
        <EmptyState message={error} />
      ) : issues === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : issues.length === 0 ? (
        <EmptyState message={EMPTY_HINT} />
      ) : (
        <div className="flex flex-1 items-start gap-4 overflow-x-auto">
          {columns.map(([state, stateIssues]) => (
            <div key={state} className="w-64 shrink-0">
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                {state}{" "}
                <span className="font-normal">({stateIssues.length})</span>
              </h3>
              <div className="flex flex-col gap-2">
                {stateIssues.map((issue) => (
                  <Card key={issue.id}>
                    <p className="font-mono text-xs text-muted-foreground">
                      {issue.identifier}
                    </p>
                    <p className="mt-1 text-sm text-foreground">
                      {issue.title}
                    </p>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IssueTab({ threadId }: PluginThreadPanelTabProps) {
  const rpc = useRpc();
  const [state, setState] = useState<{
    issue: Issue | null;
    loaded: boolean;
    error: string | null;
  }>({ issue: null, loaded: false, error: null });

  useEffect(() => {
    let cancelled = false;
    rpc.call("issueForThread", { threadId }).then(
      (result) => {
        if (cancelled) return;
        const issue = (result as { issue?: Issue | null })?.issue ?? null;
        setState({ issue, loaded: true, error: null });
      },
      (error: unknown) => {
        if (cancelled) return;
        setState({
          issue: null,
          loaded: true,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId]);

  if (state.error !== null) {
    return <EmptyState message={state.error} className="p-4" />;
  }
  if (!state.loaded) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (state.issue === null) {
    return (
      <EmptyState
        message="No Linear issue is linked to this thread."
        className="p-4"
      />
    );
  }
  return (
    <div className="flex flex-col gap-2 overflow-auto p-4">
      <p className="font-mono text-xs text-muted-foreground">
        {state.issue.identifier}
      </p>
      <h2 className="text-sm font-semibold text-foreground">
        {state.issue.title}
      </h2>
      <p className="text-xs text-muted-foreground">State: {state.issue.state}</p>
      {state.issue.description.length > 0 ? (
        <Markdown content={state.issue.description} className="text-sm" />
      ) : (
        <p className="text-sm text-muted-foreground">(no description)</p>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.homepageSection({
    id: "open-issues",
    title: "Open Linear issues",
    component: OpenIssuesSection,
  });
  app.slots.navPanel({
    id: "board",
    title: "Linear",
    icon: "Columns",
    path: "board",
    component: Board,
  });
  app.slots.threadPanelTab({
    id: "issue",
    title: "Issue",
    component: IssueTab,
    // Synchronous by contract: reads the module-level link cache primed
    // above. False until the cache loads — never a dead tab.
    visible: ({ threadId }) =>
      linkedThreadIds !== null && linkedThreadIds.has(threadId),
  });
});
