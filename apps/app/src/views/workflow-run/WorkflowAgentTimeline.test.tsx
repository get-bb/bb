// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildThreadEventRow, turnScope } from "@bb/domain";
import type { ThreadEventRow } from "@bb/domain";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { WorkflowAgentTimeline } from "./WorkflowAgentTimeline";

const RUN_ID = "wfr_run1";
// Agent display indexes are 1-based and journal-stable: the first agent's
// log is `agents/1.events.jsonl` and its thread id is `wfa_<runId>_1`.
const AGENT_INDEX = 1;
const AGENT_THREAD_ID = `wfa_${RUN_ID}_${AGENT_INDEX}`;
const AGENT_EVENTS_PATHNAME = `/api/v1/workflow-runs/${RUN_ID}/agents/${AGENT_INDEX}/events`;
const PROVIDER_THREAD_ID = "agent-session-1";
const TURN_ID = "turn-1";
const AGENT_MESSAGE_TEXT = "alpha bravo combined.";

/**
 * A minimal but production-shaped per-agent event log: workflow agent logs
 * contain provider events only (turn/started → items → turn/completed; no
 * client/turn rows), exactly what the executor appends to
 * `agents/<index>.events.jsonl` and the server route re-parses into
 * ThreadEventRow[].
 */
function agentLogFixtureRows(): ThreadEventRow[] {
  const scope = turnScope(TURN_ID);
  return [
    buildThreadEventRow({
      id: `${AGENT_THREAD_ID}.1`,
      scope,
      threadId: AGENT_THREAD_ID,
      seq: 1,
      createdAt: 1_748_000_000_001,
      event: {
        type: "turn/started",
        threadId: AGENT_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        scope,
      },
    }),
    buildThreadEventRow({
      id: `${AGENT_THREAD_ID}.2`,
      scope,
      threadId: AGENT_THREAD_ID,
      seq: 2,
      createdAt: 1_748_000_000_002,
      event: {
        type: "item/completed",
        threadId: AGENT_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        scope,
        item: {
          type: "agentMessage",
          id: "assistant-1",
          text: AGENT_MESSAGE_TEXT,
        },
      },
    }),
    buildThreadEventRow({
      id: `${AGENT_THREAD_ID}.3`,
      scope,
      threadId: AGENT_THREAD_ID,
      seq: 3,
      createdAt: 1_748_000_000_003,
      event: {
        type: "turn/completed",
        threadId: AGENT_THREAD_ID,
        providerThreadId: PROVIDER_THREAD_ID,
        scope,
        status: "completed",
      },
    }),
  ];
}

interface RenderAgentTimelineArgs {
  handler: (request: Request) => Response;
}

interface RequestUrlRef {
  current: URL | null;
}

function renderAgentTimeline({ handler }: RenderAgentTimelineArgs) {
  installFetchRoutes([{ pathname: AGENT_EVENTS_PATHNAME, handler }]);
  const harness = createQueryClientTestHarness();
  return render(
    <WorkflowAgentTimeline
      agentIndex={AGENT_INDEX}
      isAgentLive={false}
      runId={RUN_ID}
    />,
    { wrapper: harness.wrapper },
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkflowAgentTimeline", () => {
  it("fetches the 1-based agent log and renders it as timeline rows via the real build path", async () => {
    const requestUrlRef: RequestUrlRef = { current: null };
    const view = renderAgentTimeline({
      handler: (request) => {
        requestUrlRef.current = new URL(request.url);
        return jsonResponse(agentLogFixtureRows());
      },
    });

    // The fixture log decodes through decodeThreadEventRow and projects
    // through buildThreadTimelineFromEvents into non-empty rendered rows —
    // the agent's final message must be visible.
    await waitFor(() => {
      expect(view.container.textContent ?? "").toContain(AGENT_MESSAGE_TEXT);
    });

    const requestUrl = requestUrlRef.current;
    if (requestUrl === null) {
      throw new Error("Expected the agent events request to be issued.");
    }
    expect(requestUrl.pathname).toBe(AGENT_EVENTS_PATHNAME);
  });

  it("skips undecodable rows and renders the rest (tolerant-reader stance)", async () => {
    // A stale SPA bundle can meet an event type a newer server added (the
    // route's per-line tolerance accepts it; the old client schema does
    // not). The decode must skip that row with a warning, never crash the
    // page out of render.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scope = turnScope(TURN_ID);
    const futureSchemaRow = {
      id: `${AGENT_THREAD_ID}.99`,
      scope,
      threadId: AGENT_THREAD_ID,
      seq: 99,
      createdAt: 1_748_000_000_004,
      type: "item/fromTheFuture",
      data: { type: "item/fromTheFuture", scope },
    };
    const view = renderAgentTimeline({
      handler: () =>
        jsonResponse([...agentLogFixtureRows(), futureSchemaRow]),
    });

    await waitFor(() => {
      expect(view.container.textContent ?? "").toContain(AGENT_MESSAGE_TEXT);
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "Skipping undecodable workflow agent event row",
      futureSchemaRow.id,
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("renders the missing-log empty state for a 404 instead of an error", async () => {
    renderAgentTimeline({
      handler: () =>
        jsonResponse({ error: "agent log not found" }, { status: 404 }),
    });

    await waitFor(() => {
      expect(
        screen.getByText("No timeline recorded for this agent yet."),
      ).toBeTruthy();
    });
  });

  it("renders the host-offline state for a 502 instead of an error", async () => {
    renderAgentTimeline({
      handler: () =>
        jsonResponse(
          { error: "host unavailable", code: "host_unavailable" },
          { status: 502 },
        ),
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "Host offline — the agent timeline is unavailable until the host reconnects.",
        ),
      ).toBeTruthy();
    });
  });
});
