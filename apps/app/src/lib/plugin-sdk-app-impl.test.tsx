// @vitest-environment jsdom

import { LazyMarkdownHtml } from "@/components/ui/lazy-markdown-html";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { ThreadTimelineNavigationProvider } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";
import { AppNavigationHostProvider } from "./app-navigation-host";

beforeAll(() => LazyMarkdownHtml.preload());

afterEach(cleanup);

describe("plugin SDK Markdown", () => {
  it("uses the surrounding thread detail navigation for file and web links", () => {
    const onOpenLink = vi.fn(() => false);
    const openUrl = vi.fn(() => true);
    const onOpenLocalFileLink = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;

    render(
      <AppNavigationHostProvider capabilities={{ openUrl }}>
        <ThreadTimelineNavigationProvider
          environmentId={null}
          onOpenLink={onOpenLink}
          onOpenLocalFileLink={onOpenLocalFileLink}
          resolveMentionLink={() => null}
          threadId="thr_plugin"
          workspaceRootPath="/workspace"
        >
          <Markdown content="Open [README](README.md), ![chart](images/chart.png), or [the docs](https://example.com/docs)." />
        </ThreadTimelineNavigationProvider>
      </AppNavigationHostProvider>,
    );

    const fileLink = screen.getByRole("link", { name: "README" });
    expect(fileLink.getAttribute("href")).toBe("file:///workspace/README.md");
    fireEvent.click(fileLink);
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: "/workspace/README.md",
    });
    expect(screen.getByRole("img", { name: "chart" }).getAttribute("src")).toBe(
      "/api/v1/threads/thr_plugin/host-files/workspace/images/chart.png",
    );

    fireEvent.click(screen.getByRole("link", { name: "the docs" }));
    expect(openUrl).toHaveBeenCalledWith({
      url: "https://example.com/docs",
    });
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it.each(["workspace", "thread-storage"] as const)(
    "resolves nested %s document destinations independently of message context",
    (kind) => {
      const openFilePreview = vi.fn(() => true);
      const openUrl = vi.fn(() => true);
      const Markdown = pluginSdkAppImplementation.Markdown;
      const rootPath = kind === "workspace" ? "/workspace" : "/storage";
      const target =
        kind === "workspace"
          ? {
              kind,
              environmentId: "env_document",
              path: "reports/nested/report.md",
            }
          : {
              kind,
              threadId: "thr_document",
              path: "reports/nested/report.md",
            };
      const props = {
        content:
          '[Sibling](sibling.md#L2-L4) ![Chart](../chart%20one.svg) [Parent](../summary.md) [Missing](missing.md) [Web](https://example.com)\n\n<video src="../clip.mp4" controls title="Clip"></video>',
        experimental_document: { target, rootPath, threadId: "thr_document" },
      };
      render(
        <AppNavigationHostProvider capabilities={{ openFilePreview, openUrl }}>
          <ThreadTimelineNavigationProvider
            environmentId="env_other"
            onOpenLink={() => false}
            onOpenLocalFileLink={() => {
              throw new Error("Used ambient workspace");
            }}
            resolveMentionLink={() => null}
            threadId="thr_other"
            workspaceRootPath="/wrong-workspace"
          >
            <Markdown {...props} />
          </ThreadTimelineNavigationProvider>
        </AppNavigationHostProvider>,
      );
      fireEvent.click(screen.getByRole("link", { name: "Sibling" }));
      expect(openFilePreview).toHaveBeenLastCalledWith({
        target: { ...target, path: "reports/nested/sibling.md" },
        location: { kind: "range", startLine: 2, endLine: 4 },
      });
      expect(
        screen.getByRole("img", { name: "Chart" }).getAttribute("src"),
      ).toBe(
        kind === "workspace"
          ? "/api/v1/environments/env_document/files/reports/chart%20one.svg"
          : "/api/v1/threads/thr_document/thread-storage/files/reports/chart%20one.svg",
      );
      expect(screen.getByLabelText("Clip").getAttribute("src")).toBe(
        kind === "workspace"
          ? "/api/v1/environments/env_document/files/reports/clip.mp4"
          : "/api/v1/threads/thr_document/thread-storage/files/reports/clip.mp4",
      );
      fireEvent.click(screen.getByRole("link", { name: "Parent" }));
      expect(openFilePreview).toHaveBeenLastCalledWith({
        target: { ...target, path: "reports/summary.md" },
        location: null,
      });
      fireEvent.click(screen.getByRole("link", { name: "Missing" }));
      expect(openFilePreview).toHaveBeenLastCalledWith({
        target: { ...target, path: "reports/nested/missing.md" },
        location: null,
      });
      fireEvent.click(screen.getByRole("link", { name: "Web" }));
      expect(openUrl).toHaveBeenCalledWith({ url: "https://example.com" });
    },
  );

  it("keeps escaping relative paths out of file navigation and preserves absolute links", () => {
    const openFilePreview = vi.fn(() => true);
    const onOpenLocalFileLink = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;
    render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <ThreadTimelineNavigationProvider
          environmentId={null}
          onOpenLink={() => false}
          onOpenLocalFileLink={onOpenLocalFileLink}
          resolveMentionLink={() => null}
          threadId="thr_document"
          workspaceRootPath="/workspace"
        >
          <Markdown
            content="[Escape](../../../outside.md) ![Escape](../../../outside.svg) [Absolute](/outside.md) ![Absolute](/outside.svg)"
            experimental_document={{
              rootPath: "/storage",
              threadId: "thr_document",
              target: {
                kind: "thread-storage",
                threadId: "thr_document",
                path: "reports/report.md",
              },
            }}
          />
        </ThreadTimelineNavigationProvider>
      </AppNavigationHostProvider>,
    );
    expect(
      screen.getByRole("link", { name: "Escape" }).getAttribute("href"),
    ).toBe("../../../outside.md");
    expect(
      screen.getByRole("img", { name: "Escape" }).getAttribute("src"),
    ).toBe("../../../outside.svg");
    expect(openFilePreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Absolute" }));
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      path: "/outside.md",
      lineRange: null,
    });
    expect(
      screen.getByRole("img", { name: "Absolute" }).getAttribute("src"),
    ).toBe("/api/v1/threads/thr_document/host-files/outside.svg");
  });

  it("routes web links without requiring a thread navigation context", () => {
    const openUrl = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;
    render(
      <AppNavigationHostProvider capabilities={{ openUrl }}>
        <Markdown content="[Docs](https://example.com/docs)" />
      </AppNavigationHostProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Docs" }));
    expect(openUrl).toHaveBeenCalledWith({ url: "https://example.com/docs" });
  });
});

describe("plugin SDK navigation components", () => {
  it("sends navigate.openUrl to the navigation host", () => {
    const openUrl = vi.fn(() => true);
    const results: boolean[] = [];
    function Probe() {
      const navigate = pluginSdkAppImplementation.useBbNavigate();
      return (
        <button
          type="button"
          onClick={() => {
            results.push(navigate.openUrl("https://example.com/a"));
          }}
        >
          Open
        </button>
      );
    }
    render(
      <MemoryRouter>
        <AppNavigationHostProvider capabilities={{ openUrl }}>
          <PluginSlotMount pluginId="demo" slotKind="test" slotId="probe">
            <Probe />
          </PluginSlotMount>
        </AppNavigationHostProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(results).toEqual([true]);
    expect(openUrl).toHaveBeenCalledWith({ url: "https://example.com/a" });
  });

  it("exposes the file link through the real runtime", () => {
    const openFilePreview = vi.fn(() => true);
    const FileLink = pluginSdkAppImplementation.experimental_FileLink;
    render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <FileLink
          target={{
            kind: "thread-storage",
            threadId: "thr_1",
            path: "reports/result.md",
          }}
        >
          result.md
        </FileLink>
      </AppNavigationHostProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "result.md" }));
    expect(openFilePreview).toHaveBeenCalledWith({
      target: {
        kind: "thread-storage",
        threadId: "thr_1",
        path: "reports/result.md",
      },
      location: null,
    });
  });
});
