// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import { systemRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

function renderRow(row: TimelineRow) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ThreadTimelineRows
          timelineRows={[row]}
          threadRuntimeDisplayStatus="idle"
          workspaceRootPath={undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function measureSummary(height: number) {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("line-clamp-2") ? height : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("line-clamp-2") ? 40 : 0;
    },
  );
}

const summary =
  "This session was recorded with model `gpt-6-astra` but is resuming with `gpt-5.6-luna`. Consider switching back to `gpt-6-astra` as it may affect Codex performance.";

function preview() {
  const title = screen.getByTitle((title) => title.startsWith(summary));
  expect(title.classList.contains("whitespace-pre-wrap")).toBe(true);
  return title.parentElement;
}

describe("system summary overflow", () => {
  it.each([20, 40])(
    "shows a fitting %ipx summary without a toggle",
    (height) => {
      measureSummary(height);
      renderRow(
        systemRow({ operationKind: "warning", title: summary, detail: null }),
      );
      expect(preview()?.classList.contains("line-clamp-2")).toBe(true);
      expect(screen.queryByRole("button")).toBeNull();
    },
  );

  it.each([
    systemRow({ operationKind: "warning", title: summary, detail: null }),
    systemRow({ operationKind: "deprecation", title: summary, detail: "   " }),
    systemRow({
      systemKind: "error",
      title: summary,
      status: "error",
      detail: null,
    }),
    systemRow({ systemKind: "reconnect", title: summary, detail: null }),
    systemRow({ systemKind: "debug", title: summary, detail: null }),
  ])("expands an overflowing $systemKind / $operationKind summary", (row) => {
    measureSummary(60);
    renderRow(row);
    expect(preview()?.classList.contains("line-clamp-2")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(preview()?.classList.contains("line-clamp-2")).toBe(false);
    expect(
      screen
        .getByRole("button", { name: "Show less" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(preview()?.classList.contains("line-clamp-2")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Show more" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("preserves auto-expanded terminal error diagnostics", () => {
    const detail = "Error: connection failed\n    at reconnect (client.ts:42)";
    renderRow(
      systemRow({
        systemKind: "error",
        title: "Provider error",
        status: "error",
        detail,
      }),
    );
    expect(screen.getByText(/at reconnect/).textContent).toContain(detail);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });
});
