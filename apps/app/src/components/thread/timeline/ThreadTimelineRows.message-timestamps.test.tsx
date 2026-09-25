// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TimelineRow } from "@bb/server-contract";
import { conversationRow, turnRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadProviderContext } from "../thread-provider-context";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { formatMessageClockTime } from "./MessageTimestamp";

afterEach(cleanup);

function messageTimestamps(timelineRows: TimelineRow[]): string[] {
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
          />
        </ThreadProviderContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return [...container.querySelectorAll("[data-message-timestamp]")].map(
    (node) => node.textContent ?? "",
  );
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

describe("message timestamps", () => {
  it("shows the prompt time and the elapsed turn on both messages", () => {
    const userCreatedAt = new Date(2026, 2, 5, 14, 32, 10).getTime();
    const assistantCreatedAt = userCreatedAt + 83_000;

    const stamps = messageTimestamps([
      userMessage(userCreatedAt),
      turnRow({
        id: "turn-row",
        seq: 2,
        turnId: "turn-1",
        startedAt: userCreatedAt,
        durationMs: 83_000,
      }),
      assistantMessage(assistantCreatedAt),
    ]);

    expect(stamps).toEqual([
      `${formatMessageClockTime(userCreatedAt)} · 1m 23s`,
      `${formatMessageClockTime(assistantCreatedAt)} · 1m 23s`,
    ]);
  });

  it("shows only the clock time when the turn is unknown", () => {
    const userCreatedAt = new Date(2026, 2, 5, 14, 32, 10).getTime();

    const stamps = messageTimestamps([
      conversationRow({
        id: "lonely-assistant",
        seq: 1,
        role: "assistant",
        text: "ANSWER",
        createdAt: userCreatedAt,
        startedAt: userCreatedAt,
        turnId: null,
      }),
    ]);

    expect(stamps).toEqual([formatMessageClockTime(userCreatedAt)]);
  });
});
