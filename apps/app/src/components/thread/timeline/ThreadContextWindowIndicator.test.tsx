// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type {
  ThreadContextWindowUsage,
  ThreadPromptCacheUsage,
} from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadContextWindowIndicator } from "./ThreadContextWindowIndicator.js";

function contextUsage(
  promptCacheUsage: ThreadPromptCacheUsage,
): ThreadContextWindowUsage {
  return {
    estimated: false,
    modelContextWindow: 200_000,
    promptCacheUsage,
    usedTokens: 80_000,
  };
}

afterEach(cleanup);

describe("ThreadContextWindowIndicator prompt cache", () => {
  it("shows a positive cache hit with its token count and percentage", () => {
    render(
      <ThreadContextWindowIndicator
        usage={contextUsage({
          status: "reported",
          cachedInputTokens: 60_000,
          inputTokens: 80_000,
        })}
        defaultOpen
      />,
    );

    expect(
      screen.getByRole("button", {
        name: /context window 40% used; prompt cache 75% hit/i,
      }),
    ).not.toBeNull();
    expect(screen.getByText("75% hit")).not.toBeNull();
    expect(
      screen.getByText("60,000 cached of 80,000 input tokens"),
    ).not.toBeNull();
  });

  it("distinguishes a reported cache miss", () => {
    render(
      <ThreadContextWindowIndicator
        usage={contextUsage({
          status: "reported",
          cachedInputTokens: 0,
          inputTokens: 80_000,
        })}
        defaultOpen
      />,
    );

    expect(
      screen.getByRole("button", { name: /no prompt cache hit/i }),
    ).not.toBeNull();
    expect(screen.getByText("No hit (0%)")).not.toBeNull();
    expect(screen.getByText("0 cached of 80,000 input tokens")).not.toBeNull();
  });

  it("shows unavailable when cache telemetry is unknown", () => {
    render(
      <ThreadContextWindowIndicator
        usage={contextUsage({ status: "unknown" })}
        defaultOpen
      />,
    );

    expect(
      screen.getByRole("button", { name: /prompt cache unavailable/i }),
    ).not.toBeNull();
    expect(screen.getByText("Unavailable")).not.toBeNull();
    expect(
      screen.getByText(
        "Cached input tokens were not reported for the latest turn.",
      ),
    ).not.toBeNull();
  });
});
