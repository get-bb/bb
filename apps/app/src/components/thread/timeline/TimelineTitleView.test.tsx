// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineTitle } from "@bb/thread-view";
import { TimelineTitleView } from "./TimelineTitleView";

afterEach(() => {
  cleanup();
});

function renderTitle(title: TimelineTitle) {
  return render(<TimelineTitleView title={title} />);
}

describe("TimelineTitleView", () => {
  it("renders terminal status decorations as subtle mono text without parentheses", () => {
    const { container } = renderTitle({
      segments: [
        {
          text: "Running command",
          em: true,
          shimmer: false,
          truncate: false,
        },
      ],
      decorations: [
        {
          kind: "status",
          status: "denied",
          durationMs: null,
          emphasis: false,
        },
      ],
      tone: "default",
      action: null,
      plain: "Running command (denied)",
    });

    const status = screen.getByText("denied");
    expect(container.textContent).toBe("Running command denied");
    expect(container.textContent).not.toContain("(denied)");
    expect(status.classList.contains("font-mono")).toBe(true);
    expect(status.classList.contains("text-xs")).toBe(true);
    expect(status.classList.contains("font-normal")).toBe(true);
    expect(status.classList.contains("text-subtle-foreground")).toBe(true);
    expect(status.classList.contains("opacity-75")).toBe(true);
  });

  it("colors an emphasized (thread-failing) error status with the semantic red", () => {
    renderTitle({
      segments: [
        {
          text: "Provider rate limit reached",
          em: true,
          shimmer: false,
          truncate: false,
        },
      ],
      decorations: [
        { kind: "status", status: "error", durationMs: null, emphasis: true },
      ],
      tone: "default",
      action: null,
      plain: "Provider rate limit reached (error)",
    });

    const status = screen.getByText("error");
    expect(status.classList.contains("text-destructive-text")).toBe(true);
    // tailwind-merge drops the muted tone in favor of the destructive color.
    expect(status.classList.contains("text-subtle-foreground")).toBe(false);
    // Still subtle: small mono + reduced opacity, not a loud banner.
    expect(status.classList.contains("font-mono")).toBe(true);
    expect(status.classList.contains("opacity-75")).toBe(true);
  });

  it("leaves a transient (non-emphasized) error status muted, not red", () => {
    renderTitle({
      segments: [
        { text: "Read src/app.ts", em: true, shimmer: false, truncate: false },
      ],
      decorations: [
        { kind: "status", status: "error", durationMs: null, emphasis: false },
      ],
      tone: "default",
      action: null,
      plain: "Read src/app.ts (error)",
    });

    const status = screen.getByText("error");
    expect(status.classList.contains("text-subtle-foreground")).toBe(true);
    expect(status.classList.contains("text-destructive-text")).toBe(false);
  });

  it("renders summary status counts as subtle mono text without parentheses", () => {
    const { container } = renderTitle({
      segments: [
        {
          text: "Ran 3 tools",
          em: false,
          shimmer: false,
          truncate: false,
        },
      ],
      decorations: [
        {
          kind: "summary-status",
          errorCount: 2,
          interruptedCount: 1,
        },
      ],
      tone: "summary",
      action: null,
      plain: "Ran 3 tools (2 errors, 1 interrupted)",
    });

    const status = screen.getByText("2 errors, 1 interrupted");
    expect(container.textContent).toBe("Ran 3 tools 2 errors, 1 interrupted");
    expect(container.textContent).not.toContain("(2 errors");
    expect(status.classList.contains("font-mono")).toBe(true);
    expect(status.classList.contains("text-xs")).toBe(true);
    expect(status.classList.contains("font-normal")).toBe(true);
    expect(status.classList.contains("text-subtle-foreground")).toBe(true);
    expect(status.classList.contains("opacity-75")).toBe(true);
  });
});
