import { useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NextStep } from "@bb/domain";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";

export default {
  title: "thread/timeline/Next step",
};

const THREAD_ID = "thr_next_step_story";
const TURN_ID = "turn_next_step_story";
const QUERY_KEY = ["threads", THREAD_ID, "next-step"];
const rows = [
  conversationRow({
    threadId: THREAD_ID,
    turnId: TURN_ID,
    id: "next-step-story-request",
    role: "user",
    text: "Check the failing CI run and fix the release blocker.",
    seq: 1,
  }),
  conversationRow({
    threadId: THREAD_ID,
    turnId: TURN_ID,
    id: "next-step-story-result",
    role: "assistant",
    text: "The release blocker is fixed. The build and the affected tests pass.",
    seq: 2,
  }),
];

function makeSuggestion(kind: "task" | "automation"): NextStep {
  const runAt = new Date();
  runAt.setDate(runAt.getDate() + 1);
  runAt.setHours(9, 0, 0, 0);
  return {
    id: "next-step-story",
    analyticsId: "c2080216-e80b-4310-9868-529952fd3ec4",
    threadId: THREAD_ID,
    turnId: TURN_ID,
    title:
      kind === "task"
        ? "Fix the 3 related failing tests"
        : "Prepare a CI failure summary for the next workday",
    why: "The CI run found related failures outside the release blocker.",
    evidence: [
      {
        source: "ci_run",
        ref: "https://github.com/example/project/actions/runs/123",
      },
    ],
    action:
      kind === "task"
        ? {
            kind,
            task: { prompt: "Fix the three related failures.", parallel: true },
          }
        : {
            kind,
            automation: {
              prompt: "Triage last night’s CI failures.",
              schedule: {
                runAt: runAt.getTime(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              },
            },
          },
    status: "proposed",
    createdAt: Date.now(),
    shownAt: Date.now(),
    result: null,
  };
}

export function Overview() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      }),
  );
  const current = useRef<NextStep | null>(makeSuggestion("automation"));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const originalFetch = globalThis.fetch;
    const prefix = `/api/v1/threads/${THREAD_ID}/next-step`;
    globalThis.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      );
      if (!url.pathname.startsWith(prefix)) return originalFetch(input, init);
      const value = current.current;
      if (value !== null) {
        if (url.pathname.endsWith("/accept")) {
          current.current = {
            ...value,
            status: "accepted",
            result:
              value.action.kind === "task"
                ? { kind: "task", threadIds: ["story-child"] }
                : { kind: "automation", automationId: "story-automation" },
          };
        } else if (url.pathname.endsWith("/dismiss")) {
          current.current = { ...value, status: "dismissed" };
        } else if (url.pathname.endsWith("/undo")) {
          current.current = { ...value, status: "undone" };
        }
      }
      return Response.json(current.current);
    };
    client.setQueryData(QUERY_KEY, current.current);
    setReady(true);
    return () => {
      globalThis.fetch = originalFetch;
      client.clear();
    };
  }, [client]);

  return (
    <QueryClientProvider client={client}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-6">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Timeline state
          <select
            defaultValue="automation"
            className="rounded border border-input bg-background p-1 text-foreground"
            onChange={(event) => {
              const value = event.target.value;
              current.current =
                value === "task" || value === "automation"
                  ? makeSuggestion(value)
                  : null;
              client.setQueryData(QUERY_KEY, current.current);
            }}
          >
            <option value="automation">Tomorrow’s result</option>
            <option value="task">Related work</option>
            <option value="none">No suggestion</option>
          </select>
        </label>
        {ready ? (
          <ThreadTimelineRows
            threadId={THREAD_ID}
            workspaceRootPath={undefined}
            timelineRows={rows}
            threadRuntimeDisplayStatus="idle"
          />
        ) : null}
      </div>
    </QueryClientProvider>
  );
}
