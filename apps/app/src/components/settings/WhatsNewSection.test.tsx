// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsNewSection } from "./WhatsNewSection";

const fixtures = vi.hoisted(() => ({
  changelog: `# Changelog

## 0.5.0

Five is here.

### Highlights

- **Faster threads:** switch instantly.

### Fixes

- Fix a five-specific crash.

### Thanks

- [@ada](https://github.com/ada), [@grace](https://github.com/grace)

## 0.4.0

Four arrives.

### Highlights

- Four's highlight.

## 0.3.0

Three.
`,
  newer: `# Changelog

## 0.6.0

Six is ready.

### Highlights

- Six's highlight.
`,
}));

vi.mock("./changelog-preview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./changelog-preview")>();
  const { parseChangelog } = await import("@bb/domain/changelog");
  return {
    ...actual,
    CHANGELOG_ENTRIES: parseChangelog(fixtures.changelog),
    RELEASE_META: {
      "0.5.0": {
        date: "October 2, 2026",
        headline: "Five headline",
        hero: { src: "https://example.test/five.png", alt: "Five in action" },
        visual: "native-windows",
      },
      "0.4.0": { date: "September 20, 2026", headline: "Four headline" },
    },
  };
});

const openUrlInExternalBrowserMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/url-open-routing", () => ({
  openUrlInExternalBrowser: openUrlInExternalBrowserMock,
}));

const SEEN_KEY = "bb.settings.updates.whats-new-seen-version";
const PREVIOUS_KEY = "bb.settings.updates.whats-new-previous-version";

function renderSection(
  installedVersion: string | null,
  availableVersion: string | null = null,
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WhatsNewSection
        installedVersion={installedVersion}
        availableVersion={availableVersion}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Changelog unavailable offline")),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("WhatsNewSection", () => {
  it("shows a compact summary of the installed release and expands the notes in place", () => {
    renderSection("0.5.0");

    const section = document.getElementById("whats-new");
    expect(section).not.toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "What's new" }),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 3, name: "Five headline" }),
    ).toBeDefined();
    expect(screen.getByText("bb 0.5.0 · October 2, 2026")).toBeDefined();
    expect(
      section
        ?.querySelector('[data-release-visual="native-windows"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    const summary = section?.querySelector("[data-whats-new-summary]");
    expect(summary?.textContent).toBe("Five is here.");
    expect(summary?.className).toContain("line-clamp-1");

    const highlight = screen.getByText("switch instantly.");
    const fixes = screen.getByText("Fix a five-specific crash.");
    expect(highlight.closest("[hidden]")).not.toBeNull();
    expect(fixes.closest("[hidden]")).not.toBeNull();
    expect(screen.queryByRole("img", { name: "Five in action" })).toBeNull();

    const showAll = screen.getByRole("button", { name: "Show all changes" });
    expect(showAll.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(showAll);

    expect(highlight.closest("[hidden]")).toBeNull();
    expect(fixes.closest("[hidden]")).toBeNull();
    expect(summary?.className).not.toContain("line-clamp-1");
    expect(
      screen.getByRole("img", { name: "Five in action" }).getAttribute("src"),
    ).toBe("https://example.test/five.png");
    expect(section?.textContent).toContain("Thanks to @ada, @grace.");
    expect(
      screen
        .getByRole("button", { name: "Show less" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("opens the installed release on the website changelog", () => {
    renderSection("0.5.0");

    fireEvent.click(
      screen.getByRole("button", { name: "Open the full bb 0.5.0 changelog" }),
    );

    expect(openUrlInExternalBrowserMock).toHaveBeenCalledWith(
      "https://getbb.app/changelog#0-5-0",
    );
  });

  it("names the previous version and collapses releases skipped since then", () => {
    window.localStorage.setItem(SEEN_KEY, "0.3.0");

    renderSection("0.5.0");

    expect(
      screen.getByText("bb 0.5.0 · October 2, 2026 · Updated from 0.3.0"),
    ).toBeDefined();
    const skipped = document.querySelector("[data-whats-new-skipped]");
    expect(skipped?.textContent).toContain("Also new since 0.3.0");
    const row = within(skipped as HTMLElement).getByRole("button", {
      name: /Four headline/,
    });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Four arrives.")).toBeNull();
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Four arrives.")).toBeDefined();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("0.5.0");
    expect(window.localStorage.getItem(PREVIOUS_KEY)).toBe("0.3.0");
  });

  it("keeps the update note after a reload until the next update", () => {
    window.localStorage.setItem(SEEN_KEY, "0.4.0");
    renderSection("0.5.0");
    cleanup();

    renderSection("0.5.0");

    expect(
      screen.getByText("bb 0.5.0 · October 2, 2026 · Updated from 0.4.0"),
    ).toBeDefined();
    expect(document.querySelector("[data-whats-new-skipped]")).toBeNull();
  });

  it("shows the installed release, not a newer one in the changelog", () => {
    renderSection("0.4.0");

    expect(
      screen.getByRole("heading", { level: 3, name: "Four headline" }),
    ).toBeDefined();
    expect(document.querySelector("[data-whats-new-hero]")).toBeNull();
    expect(document.querySelector("[data-release-visual]")).toBeNull();
    expect(screen.queryByText("Five is here.")).toBeNull();
  });

  it("adds an available update's notes from the published changelog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(fixtures.newer)),
    );

    renderSection("0.5.0", "0.6.0");

    const available = await waitFor(() => {
      const element = document.querySelector("[data-whats-new-available]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(within(available).getByText("Update available")).toBeDefined();
    expect(within(available).getByText("bb 0.6.0")).toBeDefined();
    fireEvent.click(
      within(available).getByRole("button", { name: /bb 0\.6\.0/ }),
    );
    expect(within(available).getByText("Six is ready.")).toBeDefined();
  });

  it("omits the available update when its notes cannot be fetched", async () => {
    renderSection("0.5.0", "0.6.0");

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });
    expect(document.querySelector("[data-whats-new-available]")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 3, name: "Five headline" }),
    ).toBeDefined();
  });
});
