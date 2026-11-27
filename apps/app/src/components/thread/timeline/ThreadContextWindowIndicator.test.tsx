// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { ContextSnapshot } from "@bb/domain";
import { ThreadContextWindowCard } from "./ThreadContextWindowIndicator";

const snapshot: ContextSnapshot = {
  capturedAt: "2026-11-26T00:00:00.000Z",
  providerSessionId: "session-1",
  providerTurnId: null,
  model: "claude-test",
  usedTokens: 40_000,
  contextWindowTokens: 200_000,
  autoCompactAtTokens: null,
  estimated: true,
  categories: [
    {
      id: "messages",
      label: "Messages",
      kind: "used",
      tokens: 30_000,
      entries: [],
    },
    {
      id: "memory",
      label: "Memory files",
      kind: "used",
      tokens: 10_000,
      entries: [],
    },
  ],
};

afterEach(cleanup);

it.each([
  [40_000, null],
  [50_000, "Measured at 40k tokens"],
])(
  "shows the breakdown at %i used tokens and labels an earlier measurement",
  (usedTokens, label) => {
    render(
      <ThreadContextWindowCard
        usage={{
          usedTokens,
          modelContextWindow: 200_000,
          estimated: true,
          snapshot,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details/ }));

    expect(screen.getByText("Memory files")).toBeTruthy();
    if (label === null) {
      expect(screen.queryByText(/Measured at/)).toBeNull();
    } else {
      expect(screen.getByText(label)).toBeTruthy();
    }
  },
);
