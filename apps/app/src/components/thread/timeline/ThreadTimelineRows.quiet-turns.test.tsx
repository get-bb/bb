// @vitest-environment jsdom
import { turnScope, type ThreadEvent } from "@bb/domain";
import {
  buildThreadTimelineFromEvents,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

const THREAD_ID = "thr_quiet";
const PROVIDER_THREAD_ID = "provider-quiet";

function backgroundRunEvents(withSilentFlags: boolean): ThreadEventWithMeta[] {
  const events: ThreadEventWithMeta[] = [];
  const push = (event: ThreadEvent) => {
    const seq = events.length + 1;
    events.push({
      event,
      meta: { id: `event-${seq}`, seq, createdAt: seq * 1_000 },
    });
  };
  const fields = (turnId: string) => ({
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    scope: turnScope(turnId),
  });
  const fragment = (turnId: string, reply: string | null) => {
    push({ type: "turn/started", ...fields(turnId) });
    for (const type of ["item/started", "item/completed"] as const) {
      push({
        type,
        ...fields(turnId),
        item: {
          type: "commandExecution",
          id: `${turnId}-step`,
          command: `step ${turnId}`,
          cwd: "/repo",
          status: type === "item/started" ? "pending" : "completed",
          exitCode: type === "item/started" ? undefined : 0,
          approvalStatus: null,
        },
      });
    }
    if (reply !== null) {
      push({
        type: "item/completed",
        ...fields(turnId),
        item: { type: "agentMessage", id: `${turnId}-reply`, text: reply },
      });
    }
    push({
      type: "turn/completed",
      ...fields(turnId),
      status: "completed",
      ...(withSilentFlags && reply === null ? { silent: true as const } : {}),
    });
  };
  fragment("t1", "Three helpers are transcribing.");
  fragment("t2", null);
  fragment("t3", null);
  fragment("t4", "The first run lost its results.");
  for (let turn = 5; turn <= 16; turn += 1) fragment(`t${turn}`, null);
  fragment("t17", "I've read all 93 screenshots.");
  return events;
}

function renderedMarkup(withSilentFlags: boolean): string {
  const { rows } = buildThreadTimelineFromEvents({
    acceptedClientRequestContext: {
      acceptedClientRequestEvents: [],
      rejectedClientRequestEvents: [],
    },
    contextWindowEvents: [],
    events: backgroundRunEvents(withSilentFlags),
    options: {
      completedTurnDisplay: "collapse",
      includeNestedRows: false,
      includeDiagnosticOperations: false,
      summarizeShellCommands: true,
      isLatestPage: true,
      threadStatus: "idle",
      threadName: "",
      workspaceRoot: null,
    },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ThreadTimelineRows
          threadId={THREAD_ID}
          threadRuntimeDisplayStatus="idle"
          timelineRows={rows}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function workedTitles(markup: string): string[] {
  const text = markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return [...text.matchAll(/Worked(?: for [0-9][^ ]*)?/g)].map(
    (match) => match[0],
  );
}

describe("a background run's quiet fragments in the rendered timeline", () => {
  it("renders 3 work rows, one per reply, and no duration on folded rows", () => {
    const markup = renderedMarkup(true);

    expect(workedTitles(markup)).toEqual(["Worked for 4s", "Worked", "Worked"]);
    expect(markup).toContain("Three helpers are transcribing.");
    expect(markup).toContain("The first run lost its results.");
    expect(markup).toContain("I&#x27;ve read all 93 screenshots.");
  });

  it("renders one work row per turn for events recorded without the flag", () => {
    expect(workedTitles(renderedMarkup(false))).toHaveLength(17);
  });
});
