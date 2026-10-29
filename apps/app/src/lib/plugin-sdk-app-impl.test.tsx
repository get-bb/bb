// @vitest-environment jsdom

import {
  createApplicationLinkApprovals,
  APPLICATION_LINK_APPROVALS_STORAGE_KEY,
} from "@bb/domain/application-link-approvals";
import { ApplicationLinkApprovalsSettings } from "@/components/settings/ApplicationLinkApprovalsSettings";
import { appQueryClient as approvalQueryClient } from "./app-query-client";

import { LazyPluginMarkdown } from "@/components/plugin/lazy-plugin-renderers";
import { LazyMarkdownHtml } from "@/components/ui/lazy-markdown-html";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { ThreadTimelineNavigationProvider } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";
import { AppNavigationHostProvider } from "./app-navigation-host";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";

beforeAll(() =>
  Promise.all([LazyMarkdownHtml.preload(), LazyPluginMarkdown.preload()]),
);

afterEach(cleanup);

describe("plugin SDK Markdown", () => {
  it.each([
    ["@thread:thr_1234567890", "/projects/proj_demo/threads/thr_1234567890"],
    [
      "@thread:thr_1234567890#msg=42",
      "/projects/proj_demo/threads/thr_1234567890#msg=42",
    ],
  ])(
    "renders %s as a titled, navigable thread mention",
    async (mention, destination) => {
      const Markdown = pluginSdkAppImplementation.Markdown;
      function Location() {
        const location = useLocation();
        return (
          <output>{location.pathname + location.search + location.hash}</output>
        );
      }

      render(
        <MemoryRouter>
          <RouteNavigationProvider>
            <ThreadTitleMentionResourcesProvider
              sectionNamesById={new Map()}
              projectNamesById={new Map()}
              threadById={
                new Map([
                  [
                    "thr_1234567890",
                    {
                      id: "thr_1234567890",
                      projectId: "proj_demo",
                      title: "Rendering regression",
                      titleFallback: "Rendering regression",
                    },
                  ],
                ])
              }
            >
              <Markdown content={`Continue in ${mention}.`} />
              <Location />
            </ThreadTitleMentionResourcesProvider>
          </RouteNavigationProvider>
        </MemoryRouter>,
      );

      const link = await screen.findByRole("link", {
        name: /Rendering regression/,
      });
      expect(link.getAttribute("href")).toBe(destination);
      fireEvent.click(link);
      expect(screen.getByRole("status").textContent).toBe(destination);
    },
  );

  it("uses the surrounding thread detail navigation for file and web links", async () => {
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

    const fileLink = await screen.findByRole("link", { name: "README" });
    expect(fileLink.getAttribute("href")).toBe("file:///workspace/README.md");
    fireEvent.click(fileLink);
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      openTargetId: null,
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
    async (kind) => {
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
      fireEvent.click(await screen.findByRole("link", { name: "Sibling" }));
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

  it("keeps escaping relative paths out of file navigation and preserves absolute links", async () => {
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
      (await screen.findByRole("link", { name: "Escape" })).getAttribute(
        "href",
      ),
    ).toBe("../../../outside.md");
    expect(
      screen.getByRole("img", { name: "Escape" }).getAttribute("src"),
    ).toBe("../../../outside.svg");
    expect(openFilePreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "Absolute" }));
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      path: "/outside.md",
      lineRange: null,
      openTargetId: null,
    });
    expect(
      screen.getByRole("img", { name: "Absolute" }).getAttribute("src"),
    ).toBe("/api/v1/threads/thr_document/host-files/outside.svg");
  });

  it("routes web links without requiring a thread navigation context", async () => {
    const openUrl = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;
    render(
      <AppNavigationHostProvider capabilities={{ openUrl }}>
        <Markdown content="[Docs](https://example.com/docs)" />
      </AppNavigationHostProvider>,
    );
    fireEvent.click(await screen.findByRole("link", { name: "Docs" }));
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
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AppNavigationHostProvider capabilities={{ openUrl }}>
            <PluginSlotMount pluginId="demo" slotKind="test" slotId="probe">
              <Probe />
            </PluginSlotMount>
          </AppNavigationHostProvider>
        </MemoryRouter>
      </QueryClientProvider>,
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

function splitVariants(className: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < className.length; index += 1) {
    const char = className[index];
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth -= 1;
    else if (char === ":" && depth === 0) {
      parts.push(className.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(className.slice(start));
  return parts;
}

function utilitiesOverriddenByVariants(root: Element): string[] {
  return [root, ...root.querySelectorAll("*")].flatMap((element) => {
    const classes = [...element.classList];
    const unconditional = classes.filter(
      (name) => splitVariants(name).length === 1,
    );
    return classes.flatMap((variantClass) => {
      const parts = splitVariants(variantClass);
      if (parts.length === 1) return [];
      const utility = parts[parts.length - 1];
      return unconditional
        .filter(
          (name) => !twMerge(`${name} ${utility}`).split(" ").includes(name),
        )
        .map((name) => `${name} + ${variantClass}`);
    });
  });
}

describe("plugin SDK detail rows", () => {
  it("never pair a base utility with a variant a plugin's later copy of that utility would override", () => {
    const DetailRow = pluginSdkAppImplementation.experimental_DetailRow;
    const { container } = render(
      <dl>
        <DetailRow icon="GitBranch" label="Branch">
          main
        </DetailRow>
        <DetailRow label="Git status" align="start">
          Even with main
        </DetailRow>
      </dl>,
    );

    expect(container.querySelector("dt svg")).not.toBeNull();
    expect(utilitiesOverriddenByVariants(container)).toEqual([]);
  });
});

describe("application approval management", () => {
  afterEach(() => {
    localStorage.removeItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY);
    approvalQueryClient.clear();
  });

  it.each(["settings", "plugin"] as const)(
    "revokes through %s and updates the shared settings list",
    async (surface) => {
      const store = createApplicationLinkApprovals({
        read: () =>
          localStorage.getItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY),
        write: (value) =>
          localStorage.setItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY, value),
      });
      store.allow("linear", store.revision());
      store.allow("reflect", store.revision());
      render(
        <QueryClientProvider client={approvalQueryClient}>
          <ApplicationLinkApprovalsSettings />
        </QueryClientProvider>,
      );
      await screen.findByRole("button", { name: "Remove linear approval" });
      if (surface === "settings") {
        fireEvent.click(
          screen.getByRole("button", { name: "Remove linear approval" }),
        );
      } else {
        await act(() =>
          pluginSdkAppImplementation.experimental_revokeApplicationLinkApproval(
            "linear",
          ),
        );
      }
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Remove linear approval" }),
        ).toBeNull(),
      );
      expect(
        await pluginSdkAppImplementation.experimental_getApplicationLinkApprovals(),
      ).toEqual(["reflect"]);
      if (surface === "settings")
        fireEvent.click(
          screen.getByRole("button", { name: "Remove reflect approval" }),
        );
      else
        await act(() =>
          pluginSdkAppImplementation.experimental_revokeApplicationLinkApproval(
            null,
          ),
        );
      await screen.findByText(/^No apps are always allowed\./u);
      expect(store.list()).toEqual([]);
    },
  );
});
