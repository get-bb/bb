// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import { resolveMarkdownLocalFileTarget } from "@/components/ui/markdown-link-target";
import {
  ThreadTimelineNavigationProvider,
  useMessageLinkRouting,
} from "./ThreadTimelineNavigationContext";

afterEach(cleanup);

const storageRootPath = "/custom bb/storage/thr_demo";

function Message({ text }: { text: string }) {
  return (
    <MarkdownPreview
      content={text}
      linkRouting={useMessageLinkRouting("thr_demo")}
    />
  );
}

describe("thread-storage message links", () => {
  it.each([
    "/docs",
    "/custom bb/storage/thr_demo2/exports",
    `${storageRootPath}/../thr_other/exports`,
    `${storageRootPath}/%2e%2e/thr_other/exports`,
    `${storageRootPath}/README:0`,
    `https://example.com${storageRootPath}/exports`,
  ])("keeps %s outside the additional local-path scope", (href) => {
    expect(
      resolveMarkdownLocalFileTarget(
        href,
        { kind: "trusted-host" },
        { rootPath: "/workspace", baseDir: "/workspace" },
        storageRootPath,
      ),
    ).toBeNull();
  });

  it("keeps document containment and the workspace-relative base", () => {
    expect(
      resolveMarkdownLocalFileTarget(
        `${storageRootPath}/exports`,
        { kind: "contained", rootPath: "/workspace" },
        undefined,
        storageRootPath,
      ),
    ).toBeNull();
    expect(
      resolveMarkdownLocalFileTarget(
        "Makefile",
        { kind: "trusted-host" },
        { rootPath: "/workspace", baseDir: "/workspace" },
        storageRootPath,
      )?.link.path,
    ).toBe("/workspace/Makefile");
  });

  it("normalizes Windows storage directories with a trailing separator", () => {
    expect(
      resolveMarkdownLocalFileTarget(
        "C:\\bb\\storage\\thr_demo\\exports\\",
        { kind: "trusted-host" },
        undefined,
        "C:\\bb\\storage\\thr_demo",
      )?.link.path,
    ).toBe("C:\\bb\\storage\\thr_demo\\exports");
  });

  it.each([
    [String.raw`C:\Users\me\.bb\thread-storage\thr_demo\exports`, "exports"],
    [String.raw`<C:\Users\me\.bb\thread-storage\thr_demo\exports>`, "exports"],
    ["C:\\Users\\me\\.bb\\thread-storage\\thr_demo\\exports\\", "exports"],
    [
      "<C:\\Users\\me\\.bb\\thread-storage\\thr_demo\\folder with spaces\\>",
      "folder with spaces",
    ],
  ])(
    "renders and opens Windows storage destination %s",
    (destination, name) => {
      const onOpenLocalFileLink = vi.fn(() => true);
      render(
        <MemoryRouter>
          <ThreadTimelineNavigationProvider
            environmentId="env_demo"
            hostId={null}
            onOpenLocalFileLink={onOpenLocalFileLink}
            resolveMentionLink={() => null}
            threadId="thr_demo"
            threadStorageRootPath={String.raw`C:\Users\me\.bb\thread-storage\thr_demo`}
            workspaceRootPath="C:/workspace"
          >
            <Message text={`[artifact](${destination})`} />
          </ThreadTimelineNavigationProvider>
        </MemoryRouter>,
      );
      const link = screen.getByRole("link");
      const path = `C:/Users/me/.bb/thread-storage/thr_demo/${name}`;
      expect(link.getAttribute("href")).toBe(
        `file:///${path}`.replaceAll(" ", "%20"),
      );
      fireEvent.click(link);
      expect(onOpenLocalFileLink).toHaveBeenCalledWith({
        path: path.replaceAll("/", "\\"),
        lineRange: null,
        openTargetId: null,
      });
    },
  );

  it.each([
    ["exports", "exports"],
    ["exports/", "exports"],
    ["ktalk-transcriber", "ktalk-transcriber"],
    ["folder with spaces/", "folder with spaces"],
    ["README:12", "README"],
  ])(
    "routes %s through the local file handler when storage loads",
    (suffix, path) => {
      const onOpenLocalFileLink = vi.fn(() => true);
      const resolveMentionLink = () => null;
      const message = (threadStorageRootPath?: string) => (
        <MemoryRouter>
          <ThreadTimelineNavigationProvider
            environmentId="env_demo"
            hostId={null}
            onOpenLocalFileLink={onOpenLocalFileLink}
            resolveMentionLink={resolveMentionLink}
            threadId="thr_demo"
            threadStorageRootPath={threadStorageRootPath}
            workspaceRootPath="/workspace"
          >
            <Message text={`[artifact](<${storageRootPath}/${suffix}>)`} />
          </ThreadTimelineNavigationProvider>
        </MemoryRouter>
      );
      const { rerender } = render(message());
      expect(screen.getByRole("link").getAttribute("href")).not.toMatch(
        /^file:/,
      );

      rerender(message(storageRootPath));

      const link = screen.getByRole("link");
      expect(link.getAttribute("href")).toBe(
        `file://${storageRootPath}/${path}`.replaceAll(" ", "%20") +
          (suffix === "README:12" ? "#L12" : ""),
      );
      fireEvent.click(link);
      expect(onOpenLocalFileLink).toHaveBeenCalledWith({
        path: `${storageRootPath}/${path}`,
        lineRange:
          suffix === "README:12"
            ? { startLineNumber: 12, endLineNumber: 12 }
            : null,
        openTargetId: null,
      });
    },
  );
});
