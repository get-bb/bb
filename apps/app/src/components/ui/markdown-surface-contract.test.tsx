// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyPluginMarkdown } from "@/components/plugin/lazy-plugin-renderers";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import { ConversationMessageContent } from "@/components/thread/timeline/ConversationMessageContent";
import { ThreadTimelineNavigationProvider } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { LazyMarkdownHtml } from "@/components/ui/lazy-markdown-html";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";

await Promise.all([LazyMarkdownHtml.preload(), LazyPluginMarkdown.preload()]);

const THREAD_ID = "thr_markdown";
const MENTIONED_THREAD = {
  id: "thr_1234567890",
  projectId: "proj_demo",
  title: "Rendering regression",
  titleFallback: "Rendering regression",
};
const CONTENT =
  'Continue in @thread:thr_1234567890 or read [the docs](https://example.com/docs).\n\n<video src="clip.mp4" title="Clip" controls></video>';

interface MarkdownSurface {
  name: string;
  render: (content: string) => ReactNode;
}

const SURFACES: readonly MarkdownSurface[] = [
  {
    name: "assistant message",
    render: (content) => (
      <ConversationMessageContent
        role="assistant"
        attachments={null}
        id="msg_markdown"
        threadId={THREAD_ID}
        turnId="turn_markdown"
        showActions={false}
        mobileActionDisplay="overflow"
        streaming={false}
        text={content}
        timestamp={0}
      />
    ),
  },
  {
    name: "plugin Markdown",
    render: (content) => (
      <pluginSdkAppImplementation.Markdown content={content} />
    ),
  },
  {
    name: "plugin document Markdown",
    render: (content) => (
      <pluginSdkAppImplementation.Markdown
        content={content}
        experimental_document={{
          target: { kind: "thread-storage", threadId: THREAD_ID, path: "a.md" },
          rootPath: "/storage",
          threadId: THREAD_ID,
        }}
      />
    ),
  },
];

const queryClient = new QueryClient();

function SurfaceHost({
  children,
  openUrl,
}: {
  children: ReactNode;
  openUrl: (intent: { url: string }) => boolean;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RouteNavigationProvider>
          <ThreadTitleMentionResourcesProvider
            sectionNamesById={new Map()}
            projectNamesById={new Map()}
            threadById={new Map([[MENTIONED_THREAD.id, MENTIONED_THREAD]])}
          >
            <AppNavigationHostProvider capabilities={{ openUrl }}>
              <ThreadTimelineNavigationProvider
                environmentId={null}
                hostId={null}
                onOpenLocalFileLink={() => true}
                resolveMentionLink={() => null}
                threadId={THREAD_ID}
                workspaceRootPath="/workspace"
              >
                {children}
              </ThreadTimelineNavigationProvider>
            </AppNavigationHostProvider>
          </ThreadTitleMentionResourcesProvider>
        </RouteNavigationProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(SURFACES)("Markdown surface contract: $name", (surface) => {
  it("renders a thread token as the titled thread mention", async () => {
    render(
      <SurfaceHost openUrl={() => true}>{surface.render(CONTENT)}</SurfaceHost>,
    );
    const link = await screen.findByRole("link", {
      name: /Rendering regression/,
    });
    expect(link.getAttribute("href")).toBe(
      "/projects/proj_demo/threads/thr_1234567890",
    );
  });

  it("opens web links through the surface's navigation host", async () => {
    const openUrl = vi.fn(() => true);
    render(
      <SurfaceHost openUrl={openUrl}>{surface.render(CONTENT)}</SurfaceHost>,
    );
    fireEvent.click(await screen.findByRole("link", { name: "the docs" }));
    expect(openUrl).toHaveBeenCalledWith({ url: "https://example.com/docs" });
  });

  it("keeps media elements mounted when the navigation host changes", async () => {
    const view = render(
      <SurfaceHost openUrl={() => true}>{surface.render(CONTENT)}</SurfaceHost>,
    );
    const video = await screen.findByLabelText("Clip");
    view.rerender(
      <SurfaceHost openUrl={() => false}>
        {surface.render(CONTENT)}
      </SurfaceHost>,
    );
    expect(screen.getByLabelText("Clip")).toBe(video);
  });
});
