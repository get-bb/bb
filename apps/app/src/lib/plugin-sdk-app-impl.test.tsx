// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadTimelineNavigationProvider } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";

afterEach(cleanup);

describe("plugin SDK Markdown", () => {
  it("uses the surrounding thread detail navigation for file and web links", () => {
    const onOpenLink = vi.fn(() => true);
    const onOpenLocalFileLink = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;

    render(
      <ThreadTimelineNavigationProvider
        environmentId={null}
        onOpenLink={onOpenLink}
        onOpenLocalFileLink={onOpenLocalFileLink}
        resolveMentionLink={() => null}
        workspaceRootPath="/workspace"
      >
        <Markdown content="Open [README](README.md) or [the docs](https://example.com/docs)." />
      </ThreadTimelineNavigationProvider>,
    );

    const fileLink = screen.getByRole("link", { name: "README" });
    expect(fileLink.getAttribute("href")).toBe("file:///workspace/README.md");
    fireEvent.click(fileLink);
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: "/workspace/README.md",
    });

    fireEvent.click(screen.getByRole("link", { name: "the docs" }));
    expect(onOpenLink).toHaveBeenCalledWith({
      href: "https://example.com/docs",
    });
  });
});
