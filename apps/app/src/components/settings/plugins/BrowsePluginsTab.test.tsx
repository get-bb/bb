// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BrowsePluginsTab } from "./BrowsePluginsTab";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BrowsePluginsTab", () => {
  it("shows catalog icons and truncates long source labels", async () => {
    const source =
      "github-release:ymichael/bb/bb-plugin-memory-{version}.tgz@^0.1.0";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/marketplaces") {
          return jsonResponse({
            marketplaces: [
              {
                id: "bb-official",
                name: "bb-official",
                displayName: "BB Official",
                source: "https://github.com/ymichael/bb.git@main",
                pluginCount: 3,
              },
            ],
          });
        }
        if (url === "/api/v1/marketplaces/search?q=") {
          return jsonResponse({
            results: [
              {
                marketplaceId: "bb-official",
                entryId: "memory",
                displayName: "Memory",
                description: "Provider-independent durable memory for agents.",
                icon: "Brain",
                category: "Productivity",
                source,
                installed: false,
                compatible: true,
              },
            ],
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const onInstall = vi.fn();
    const { wrapper } = createQueryClientTestHarness();
    render(<BrowsePluginsTab onInstall={onInstall} />, { wrapper });

    const card = await screen.findByTestId("browse-card-memory");
    expect(card.querySelector('[data-icon="Brain"]')).not.toBeNull();

    const sourceLine = screen.getByTestId("browse-source-memory");
    expect(sourceLine.classList.contains("truncate")).toBe(true);
    expect(sourceLine.getAttribute("title")).toBe(`BB Official · ${source}`);
    expect(sourceLine.textContent).toBe(`BB Official · ${source}`);

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(onInstall).toHaveBeenCalledWith(
      expect.objectContaining({ icon: "Brain" }),
    );
  });
});
