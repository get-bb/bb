// @vitest-environment jsdom

import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFileForOpenRequest } from "./file-download";

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: toastMocks,
}));

afterEach(() => {
  toastMocks.error.mockReset();
  vi.unstubAllGlobals();
});

describe("downloadFileForOpenRequest", () => {
  it("reports an HTTP failure without saving the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("too large", { status: 413 })),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    expect(
      downloadFileForOpenRequest({
        projectHostId: null,
        projectId: null,
        request: {
          kind: "host-file-preview",
          tab: { lineRange: null, path: "/tmp/report.pdf" },
        },
        resolvedEnvironmentId: "env_1",
        threadId: "thr_1",
      }),
    ).toBe(true);

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith("Failed to download file", {
        description: "Download failed with status 413",
      }),
    );
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("refuses an unresolved workspace target instead of using the primary source", () => {
    expect(
      downloadFileForOpenRequest({
        projectHostId: null,
        projectId: "proj_1",
        request: {
          kind: "workspace-file-preview",
          tab: {
            lineRange: null,
            path: "report.pdf",
            source: { kind: "working-tree" },
            statusLabel: null,
          },
        },
        resolvedEnvironmentId: undefined,
        threadId: "thr_1",
      }),
    ).toBe(false);
  });
});
