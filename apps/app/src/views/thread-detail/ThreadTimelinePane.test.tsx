// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ThreadTimelineSurfaceProps } from "@/components/thread/timeline/ThreadTimelineSurface";

vi.mock("@/components/thread/timeline/ThreadTimelineSurface", () => ({
  ThreadTimelineSurface: (props: ThreadTimelineSurfaceProps) => (
    <div data-testid="timeline">
      {props.onOpenPluginPanel === undefined ? "missing" : "available"}
    </div>
  ),
}));

vi.mock("@/components/thread/toc/ThreadTableOfContents", () => ({
  ThreadTableOfContents: () => null,
}));

const { ThreadTimelinePane } = await import("./ThreadTimelinePane");

afterEach(cleanup);

it("forwards the plugin-panel opener to rendered message directives", () => {
  render(
    <ThreadTimelinePane
      activeThinking={null}
      canSpawnChild={false}
      footer={null}
      hasOlderTimelineRows={false}
      isLoadingOlderTimelineRows={false}
      isStopping={false}
      isThreadTimelinePending={false}
      onLoadOlderRows={() => undefined}
      onOpenPluginPanel={() => true}
      projectId="proj_1"
      resolveMentionLink={() => null}
      showOngoingIndicator={false}
      stoppingAnchorAt={0}
      threadId="thr_1"
      threadRuntimeDisplayStatus="idle"
      timelineError={false}
      timelineRows={[]}
      unreadDividerAutoScroll={false}
      unreadDividerPlacement={null}
      workspaceRootPath={undefined}
    />,
  );

  expect(screen.getByTestId("timeline").textContent).toBe("available");
});
