// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { allPluginListQueryKeyPrefix } from "@/hooks/queries/query-keys";
import {
  CheckPluginUpdatesButton,
  summarizeUpdateCheck,
} from "./CheckPluginUpdatesButton";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const installed = { version: "1.0.0", display: "1.0.0" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("summarizeUpdateCheck", () => {
  it("counts available updates and names them", () => {
    expect(
      summarizeUpdateCheck([
        {
          id: "b",
          outcome: "update-available",
          devMode: false,
          installed,
          candidate: { version: "1.1.0", display: "1.1.0" },
          blocked: null,
          detail: null,
        },
        {
          id: "a",
          outcome: "update-available",
          devMode: false,
          installed,
          candidate: { version: "2.0.0", display: "2.0.0" },
          blocked: null,
          detail: null,
        },
        {
          id: "c",
          outcome: "current",
          devMode: false,
          installed,
          candidate: null,
          blocked: null,
          detail: null,
        },
      ]),
    ).toEqual({
      tone: "success",
      title: "2 plugin updates available",
      description: "a, b",
    });
  });

  it("reports up to date and mentions incompatible newer releases", () => {
    const blocked = {
      id: "a",
      outcome: "incompatible" as const,
      devMode: false,
      installed,
      candidate: null,
      blocked: { version: "3.0.0", reasons: ["needs bb >=9"] },
      detail: null,
    };
    expect(summarizeUpdateCheck([blocked])).toEqual({
      tone: "message",
      title: "All plugins are up to date",
      description: "a has a newer release that needs a newer bb.",
    });
    expect(summarizeUpdateCheck([blocked], { pluginId: "a" })).toMatchObject({
      title: "a is up to date",
    });
  });
});

describe("CheckPluginUpdatesButton", () => {
  it("posts a check for every plugin and refetches the plugin list", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        results: [
          { id: "a", outcome: "current", installed },
          {
            id: "b",
            outcome: "update-available",
            installed,
            candidate: { version: "1.1.0", display: "1.1.0" },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper, queryClient } = createQueryClientTestHarness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(<CheckPluginUpdatesButton />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/plugins/updates/check");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    await vi.waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: allPluginListQueryKeyPrefix(),
      }),
    );
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeTruthy();
  });

  it("scopes the check to one plugin when given an id", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ results: [{ id: "a", outcome: "current", installed }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = createQueryClientTestHarness();
    render(<CheckPluginUpdatesButton pluginId="a" appearance="inline" />, {
      wrapper,
    });

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({ id: "a" });
  });
});
