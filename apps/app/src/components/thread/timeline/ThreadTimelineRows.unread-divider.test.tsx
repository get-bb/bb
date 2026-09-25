// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TimelineRow } from "@bb/server-contract";
import {
  commandRow,
  conversationRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import type { ThreadTimelineUnreadDividerPlacement } from "./types";
import { ThreadProviderContext } from "../thread-provider-context";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

const DIVIDER = "__divider__";

afterEach(cleanup);

function renderTopLevelSequence(
  timelineRows: TimelineRow[],
  unreadDividerPlacement: ThreadTimelineUnreadDividerPlacement | null,
): string[] {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ThreadProviderContext.Provider
          value={{ providerId: "echo-agent", pluginId: "echo-provider" }}
        >
          <ThreadTimelineRows
            threadId="thr_main"
            threadRuntimeDisplayStatus="idle"
            workspaceRootPath={undefined}
            timelineRows={timelineRows}
            unreadDividerPlacement={unreadDividerPlacement}
          />
        </ThreadProviderContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const list = container.querySelector('[data-timeline-row-list="top-level"]');
  if (list === null) {
    throw new Error("Timeline did not render a top-level row list");
  }
  return [...list.children].map((child) =>
    child.querySelector('[data-testid="thread-unread-divider"]') === null
      ? // bb-fork(windows): message timestamps are chrome, not row content.
        withoutMessageTimestamps(child)
      : DIVIDER,
  );
}

function withoutMessageTimestamps(child: Element): string {
  const clone = child.cloneNode(true) as Element;
  for (const timestamp of clone.querySelectorAll("[data-message-timestamp]")) {
    timestamp.remove();
  }
  return clone.textContent ?? "";
}

function userMessage(createdAt: number): TimelineRow {
  return conversationRow({
    id: `user-${createdAt}`,
    seq: createdAt,
    role: "user",
    text: "PROMPT",
    createdAt,
    startedAt: createdAt,
    turnId: "turn-1",
  });
}

function assistantMessage(createdAt: number): TimelineRow {
  return conversationRow({
    id: `assistant-${createdAt}`,
    seq: createdAt,
    role: "assistant",
    text: "ANSWER",
    createdAt,
    startedAt: createdAt,
    turnId: "turn-1",
  });
}

function command(createdAt: number): TimelineRow {
  return commandRow({
    id: `command-${createdAt}`,
    seq: createdAt,
    command: `echo ${createdAt}`,
    createdAt,
    startedAt: createdAt,
    turnId: "turn-1",
  });
}

describe("unread divider placement", () => {
  it("keeps the divider below a work group the reader already saw part of", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        command(200),
        command(300),
        command(400),
        assistantMessage(500),
      ],
      { kind: "after-cutoff", cutoffAt: 350 },
    );

    expect(sequence).toEqual(["PROMPT", "Ran 3 commands", DIVIDER, "ANSWER"]);
  });

  it("places the divider above a work group that started after the cutoff", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        assistantMessage(200),
        command(400),
        command(500),
        assistantMessage(600),
      ],
      { kind: "after-cutoff", cutoffAt: 300 },
    );

    expect(sequence).toEqual([
      "PROMPT",
      "ANSWER",
      DIVIDER,
      "Ran 2 commands",
      "ANSWER",
    ]);
  });

  it("matches collapsed-turn placement when finished turns stay flat", () => {
    const collapsed = renderTopLevelSequence(
      [
        userMessage(100),
        turnRow({
          id: "turn-row",
          seq: 100,
          createdAt: 100,
          startedAt: 100,
          turnId: "turn-1",
          summaryCount: 3,
          children: [command(200), command(300), command(400)],
        }),
        assistantMessage(500),
      ],
      { kind: "after-cutoff", cutoffAt: 350 },
    );

    expect(collapsed).toEqual(["PROMPT", "Worked for 4s", DIVIDER, "ANSWER"]);
  });

  it("never anchors the divider on the reader's own message", () => {
    const sequence = renderTopLevelSequence(
      [assistantMessage(100), userMessage(400), command(500)],
      { kind: "after-cutoff", cutoffAt: 300 },
    );

    expect(sequence).toEqual(["ANSWER", "PROMPT", DIVIDER, "Ran echo 500 2s"]);
  });

  it("omits the divider when no row started after the cutoff", () => {
    const sequence = renderTopLevelSequence(
      [userMessage(100), command(200), assistantMessage(300)],
      { kind: "after-cutoff", cutoffAt: 400 },
    );

    expect(sequence).not.toContain(DIVIDER);
  });

  it("places the divider above the first row for an explicitly unread thread", () => {
    const sequence = renderTopLevelSequence(
      [userMessage(100), command(200), assistantMessage(300)],
      { kind: "before-first" },
    );

    expect(sequence[0]).toBe(DIVIDER);
  });
});
