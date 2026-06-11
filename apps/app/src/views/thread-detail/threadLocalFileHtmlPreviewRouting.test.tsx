// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HostFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
} from "@/components/secondary-panel/ThreadSecondaryPanelTabContent";
import { useThreadStorageViewer } from "@/components/secondary-panel/useThreadStorageViewer";
import type { ThreadTimelineLocalFileLink } from "@/components/thread/timeline";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import type { FilePreviewLineRange } from "@/lib/file-preview";
import { resolveThreadLocalFileLink } from "@/lib/thread-local-file-links";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";

interface MarkdownHtmlPreviewHarnessProps {
  markdownPath: string;
  threadStorageRootPath: string | null;
  workspaceRootPath: string | null;
}

interface HostOpenedFile {
  kind: "host";
  lineRange: FilePreviewLineRange | null;
  path: string;
}

interface ThreadStorageOpenedFile {
  kind: "thread-storage";
  lineRange: FilePreviewLineRange | null;
  path: string;
}

type OpenedFile = HostOpenedFile | ThreadStorageOpenedFile;

interface Deferred<TValue> {
  promise: Promise<TValue>;
  reject: (reason?: Error) => void;
  resolve: (value: TValue) => void;
}

const THREAD_ID = "thread-1";
const ENVIRONMENT_ID = "env-1";

function createDeferred<TValue>(): Deferred<TValue> {
  let resolveDeferred: ((value: TValue) => void) | null = null;
  let rejectDeferred: ((reason?: Error) => void) | null = null;
  const promise = new Promise<TValue>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  if (resolveDeferred === null || rejectDeferred === null) {
    throw new Error("Failed to initialize deferred promise");
  }

  return {
    promise,
    reject: rejectDeferred,
    resolve: resolveDeferred,
  };
}

function MarkdownHtmlPreviewHarness({
  markdownPath,
  threadStorageRootPath,
  workspaceRootPath,
}: MarkdownHtmlPreviewHarnessProps) {
  const [openedFile, setOpenedFile] = useState<OpenedFile | null>(null);
  const handleOpenLocalFileLink = useCallback(
    (link: ThreadTimelineLocalFileLink) => {
      const resolution = resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link,
        threadStorageRootPath,
        workspaceRootPath,
      });

      if (resolution.kind === "open-host-path") {
        setOpenedFile({
          kind: "host",
          lineRange: resolution.request.lineRange,
          path: resolution.request.path,
        });
        return true;
      }

      if (resolution.kind === "open-thread-storage-path") {
        setOpenedFile({
          kind: "thread-storage",
          lineRange: resolution.request.lineRange,
          path: resolution.request.relativePath,
        });
        return true;
      }

      return false;
    },
    [threadStorageRootPath, workspaceRootPath],
  );

  return (
    <>
      <MarkdownPreview
        content={`[file](${markdownPath})`}
        linkRouting={{
          localFile: {
            absoluteLinks: {
              kind: "trusted-host",
            },
            onOpenLink: handleOpenLocalFileLink,
          },
        }}
      />
      {openedFile?.kind === "host" ? (
        <HostFilePreviewTabContent
          activePath={openedFile.path}
          environmentId={ENVIRONMENT_ID}
          lineRange={openedFile.lineRange}
          threadId={THREAD_ID}
        />
      ) : null}
      {openedFile?.kind === "thread-storage" ? (
        <ThreadStorageFilePreviewTabContent
          activePath={openedFile.path}
          lineRange={openedFile.lineRange}
          threadId={THREAD_ID}
        />
      ) : null}
    </>
  );
}

function PanelClosedThreadStorageMarkdownLinkHarness({
  markdownPath,
  workspaceRootPath,
}: Omit<MarkdownHtmlPreviewHarnessProps, "threadStorageRootPath">) {
  const [openedFile, setOpenedFile] = useState<OpenedFile | null>(null);
  const { refetchThreadStorageFiles, threadStorageRootPath } =
    useThreadStorageViewer({
      activePath: null,
      fileListEnabled: true,
      filePreviewEnabled: false,
      threadId: THREAD_ID,
    });
  const openResolvedLink = useCallback(
    (
      link: ThreadTimelineLocalFileLink,
      resolvedThreadStorageRootPath: string | null,
    ) => {
      const resolution = resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link,
        threadStorageRootPath: resolvedThreadStorageRootPath,
        workspaceRootPath,
      });

      if (resolution.kind === "open-thread-storage-path") {
        setOpenedFile({
          kind: "thread-storage",
          lineRange: resolution.request.lineRange,
          path: resolution.request.relativePath,
        });
        return true;
      }

      if (resolution.kind === "open-host-path") {
        setOpenedFile({
          kind: "host",
          lineRange: resolution.request.lineRange,
          path: resolution.request.path,
        });
        return true;
      }

      return false;
    },
    [workspaceRootPath],
  );
  const handleOpenLocalFileLink = useCallback(
    (link: ThreadTimelineLocalFileLink) => {
      const resolution = resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link,
        threadStorageRootPath,
        workspaceRootPath,
      });

      if (
        resolution.kind !== "open-host-path" ||
        threadStorageRootPath !== null
      ) {
        return openResolvedLink(link, threadStorageRootPath);
      }

      void refetchThreadStorageFiles().then((result) => {
        openResolvedLink(link, result.data?.storageRootPath ?? null);
      });
      return true;
    },
    [
      openResolvedLink,
      refetchThreadStorageFiles,
      threadStorageRootPath,
      workspaceRootPath,
    ],
  );

  return (
    <>
      <MarkdownPreview
        content={`[file](${markdownPath})`}
        linkRouting={{
          localFile: {
            absoluteLinks: {
              kind: "trusted-host",
            },
            onOpenLink: handleOpenLocalFileLink,
          },
        }}
      />
      {openedFile?.kind === "host" ? (
        <HostFilePreviewTabContent
          activePath={openedFile.path}
          environmentId={ENVIRONMENT_ID}
          lineRange={openedFile.lineRange}
          threadId={THREAD_ID}
        />
      ) : null}
      {openedFile?.kind === "thread-storage" ? (
        <ThreadStorageFilePreviewTabContent
          activePath={openedFile.path}
          lineRange={openedFile.lineRange}
          threadId={THREAD_ID}
        />
      ) : null}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("thread local HTML preview routing", () => {
  it("opens markdown links to outside HTML files in the sandboxed iframe preview", async () => {
    const outsidePath = "/Users/me/Downloads/report.html";
    installFetchRoutes([
      {
        pathname: `/api/v1/threads/${THREAD_ID}/host-files/content`,
        handler: (request) => {
          expect(new URL(request.url).searchParams.get("path")).toBe(
            outsidePath,
          );
          return new Response("<!doctype html><h1>Report</h1>", {
            headers: { "content-type": "text/html" },
          });
        },
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <MarkdownHtmlPreviewHarness
        markdownPath={outsidePath}
        threadStorageRootPath="/Users/me/.bb/thread-storage/thread-1"
        workspaceRootPath="/Users/me/workspace"
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("link", { name: /file/u }));

    await waitFor(() => {
      expect(container.querySelector("iframe")).not.toBeNull();
    });
    const iframe = container.querySelector("iframe");
    expect(
      screen.getByRole("tablist", { name: "HTML view mode" }),
    ).toBeTruthy();
    expect(iframe?.getAttribute("src")).toBe(
      `/api/v1/threads/${THREAD_ID}/files/raw?path=${encodeURIComponent(outsidePath)}`,
    );
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("opens markdown links inside thread storage through the storage HTML preview route", async () => {
    const threadStorageRootPath = "/Users/me/.bb/thread-storage/thread-1";
    const storagePath = `${threadStorageRootPath}/reports/preview.html`;
    installFetchRoutes([
      {
        pathname: `/api/v1/threads/${THREAD_ID}/thread-storage/content`,
        handler: (request) => {
          expect(new URL(request.url).searchParams.get("path")).toBe(
            "reports/preview.html",
          );
          return new Response("<!doctype html><h1>Storage</h1>", {
            headers: { "content-type": "text/html" },
          });
        },
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <MarkdownHtmlPreviewHarness
        markdownPath={storagePath}
        threadStorageRootPath={threadStorageRootPath}
        workspaceRootPath="/Users/me/workspace"
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("link", { name: /file/u }));

    await waitFor(() => {
      expect(container.querySelector("iframe")).not.toBeNull();
    });
    const iframe = container.querySelector("iframe");
    expect(
      screen.getByRole("tablist", { name: "HTML view mode" }),
    ).toBeTruthy();
    expect(iframe?.getAttribute("src")).toBe(
      `/api/v1/threads/${THREAD_ID}/thread-storage/files/reports/preview.html`,
    );
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("preloads thread storage root so a panel-closed first click uses the storage HTML preview route", async () => {
    const threadStorageRootPath = "/Users/me/.bb/thread-storage/thread-1";
    const storagePath = `${threadStorageRootPath}/reports/preview.html`;
    const storageFilesResponse = createDeferred<Response>();
    installFetchRoutes([
      {
        pathname: `/api/v1/threads/${THREAD_ID}/thread-storage/files`,
        handler: () => storageFilesResponse.promise,
      },
      {
        pathname: `/api/v1/threads/${THREAD_ID}/thread-storage/content`,
        handler: (request) => {
          expect(new URL(request.url).searchParams.get("path")).toBe(
            "reports/preview.html",
          );
          return new Response("<!doctype html><h1>Storage</h1>", {
            headers: { "content-type": "text/html" },
          });
        },
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <PanelClosedThreadStorageMarkdownLinkHarness
        markdownPath={storagePath}
        workspaceRootPath="/Users/me/workspace"
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("link", { name: /file/u }));
    storageFilesResponse.resolve(
      jsonResponse({
        files: [],
        storageRootPath: threadStorageRootPath,
        truncated: false,
      }),
    );

    await waitFor(() => {
      expect(container.querySelector("iframe")).not.toBeNull();
    });
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(
      `/api/v1/threads/${THREAD_ID}/thread-storage/files/reports/preview.html`,
    );
  });

  it("keeps markdown links to non-HTML host files on the normal host-file preview path", async () => {
    const outsidePath = "/Users/me/Downloads/report.txt";
    const fetchMock = installFetchRoutes([
      {
        pathname: `/api/v1/threads/${THREAD_ID}/host-files/content`,
        handler: (request) => {
          expect(new URL(request.url).searchParams.get("path")).toBe(
            outsidePath,
          );
          return new Response("plain text report", {
            headers: { "content-type": "text/plain" },
          });
        },
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <MarkdownHtmlPreviewHarness
        markdownPath={outsidePath}
        threadStorageRootPath="/Users/me/.bb/thread-storage/thread-1"
        workspaceRootPath="/Users/me/workspace"
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("link", { name: /file/u }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      expect(container.querySelector("iframe")).toBeNull();
      expect(
        screen.queryByRole("tablist", { name: "HTML view mode" }),
      ).toBeNull();
    });
  });
});
