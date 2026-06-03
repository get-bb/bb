// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AppDetail } from "@bb/server-contract";
import * as api from "@/lib/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { AppTabContent } from "./AppTabContent";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    getApp: vi.fn(),
    getAppMarkdownPreview: vi.fn(),
  };
});

const HTML_APP: AppDetail = {
  applicationId: "status",
  name: "Review Board",
  entry: { path: "index.html", kind: "html" },
  capabilities: ["data", "message"],
  icon: { kind: "builtin", name: "ListTodo" },
  appsRootPath: "/tmp/bb-data/apps",
  appRootPath: "/tmp/bb-data/apps/status",
  appDataPath: "/tmp/bb-data/apps/status/data",
};

const MARKDOWN_APP: AppDetail = {
  applicationId: "readme",
  name: "Readme",
  entry: { path: "docs/index.md", kind: "md" },
  capabilities: [],
  icon: { kind: "builtin", name: "GridView" },
  appsRootPath: "/tmp/bb-data/apps",
  appRootPath: "/tmp/bb-data/apps/readme",
  appDataPath: "/tmp/bb-data/apps/readme/data",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("AppTabContent", () => {
  it("renders HTML apps in the injected app iframe route", async () => {
    vi.mocked(api.getApp).mockResolvedValue(HTML_APP);
    const { wrapper } = createQueryClientTestHarness();

    render(<AppTabContent threadId="thr_1" applicationId="status" />, {
      wrapper,
    });

    const frame = await screen.findByTitle("Review Board");
    expect(frame.getAttribute("src")).toMatch(
      /^\/api\/v1\/apps\/status\/\?targetThreadId=thr_1&v=\d+$/u,
    );
    expect(frame.getAttribute("sandbox")).toBeNull();
    expect(api.getAppMarkdownPreview).not.toHaveBeenCalled();
  });

  it("reloads HTML app iframes when app detail data refreshes", async () => {
    vi.mocked(api.getApp).mockReturnValue(new Promise(() => {}));
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const queryKey = appQueryKey("status");
    queryClient.setQueryData<AppDetail>(queryKey, HTML_APP, {
      updatedAt: 1_000,
    });

    render(<AppTabContent threadId="thr_1" applicationId="status" />, {
      wrapper,
    });

    const firstFrame = screen.getByTitle("Review Board");
    const firstSrc = firstFrame.getAttribute("src");
    act(() => {
      queryClient.setQueryData<AppDetail>(
        queryKey,
        {
          ...HTML_APP,
          name: "Review Board",
        },
        {
          updatedAt: 2_000,
        },
      );
    });

    await waitFor(() => {
      expect(screen.getByTitle("Review Board").getAttribute("src")).not.toBe(
        firstSrc,
      );
    });
  });

  it("renders markdown apps through the static markdown preview path", async () => {
    vi.mocked(api.getApp).mockResolvedValue(MARKDOWN_APP);
    vi.mocked(api.getAppMarkdownPreview).mockResolvedValue({
      kind: "text",
      path: "docs/index.md",
      name: "index.md",
      url: "/api/v1/apps/readme/assets/docs/index.md",
      mimeType: "text/markdown",
      content: "# App Notes\n\nStatic content.",
    });
    const { wrapper } = createQueryClientTestHarness();

    render(<AppTabContent threadId="thr_1" applicationId="readme" />, {
      wrapper,
    });

    expect(await screen.findByText("App Notes")).toBeTruthy();
    expect(screen.getByText("Static content.")).toBeTruthy();
    expect(api.getAppMarkdownPreview).toHaveBeenCalledWith(
      "readme",
      "docs/index.md",
      expect.any(AbortSignal),
    );
  });
});
