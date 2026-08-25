// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Experiments, StoredExperiments } from "@bb/domain";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineSurface } from "./ThreadTimelineSurface.js";

const mocks = vi.hoisted(() => ({
  experiments: undefined as StoredExperiments | undefined,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data:
      mocks.experiments === undefined
        ? undefined
        : { experiments: mocks.experiments },
  }),
}));

vi.mock("./ThreadTimelineRows.js", () => ({
  ThreadTimelineRows: ({
    timelineWindowingEnabled,
  }: {
    timelineWindowingEnabled?: boolean;
  }) => (
    <div
      data-testid="timeline-rows-stub"
      data-windowing-enabled={String(timelineWindowingEnabled)}
    />
  ),
}));

vi.mock("@/components/ui/conversation.js", () => ({
  ConversationTimeline: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

function experimentsWithTimelineWindowing(value: boolean): Experiments {
  return {
    changelogPreview: false,
    editMessages: true,
    mobileApp: false,
    providerSessionReaping: false,
    timelineWindowing: value,
  };
}

function renderSurface({ isCompactViewport }: { isCompactViewport: boolean }) {
  return render(
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <ThreadTimelineSurface
        activeThinking={null}
        isThreadTimelinePending={false}
        timelineError={false}
        showOngoingIndicator={false}
        timelineRows={[conversationRow({ text: "hello" })]}
        threadId="thread-1"
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
      />
    </CompactViewportOverrideProvider>,
  );
}

function windowingEnabledAttribute(): string | undefined {
  return screen.getByTestId("timeline-rows-stub").dataset.windowingEnabled;
}

class ResizeObserverStub implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  mocks.experiments = undefined;
  vi.unstubAllGlobals();
});

describe("ThreadTimelineSurface windowing default", () => {
  it("defaults windowing on for compact viewports while the experiment is unset", () => {
    mocks.experiments = undefined;
    renderSurface({ isCompactViewport: true });

    expect(windowingEnabledAttribute()).toBe("true");
  });

  it("defaults windowing on for compact viewports when the config payload omits the key", () => {
    // A fresh install: /system/config serves only saved choices, so a
    // never-toggled timelineWindowing arrives omitted, not false.
    mocks.experiments = {};
    renderSurface({ isCompactViewport: true });

    expect(windowingEnabledAttribute()).toBe("true");
  });

  it("keeps an explicitly false experiment as the kill switch on compact viewports", () => {
    mocks.experiments = experimentsWithTimelineWindowing(false);
    renderSurface({ isCompactViewport: true });

    expect(windowingEnabledAttribute()).toBe("false");
  });

  it("keeps desktop off while the experiment is unset", () => {
    mocks.experiments = undefined;
    renderSurface({ isCompactViewport: false });

    expect(windowingEnabledAttribute()).toBe("false");
  });

  it("honors an explicitly true experiment on desktop", () => {
    mocks.experiments = experimentsWithTimelineWindowing(true);
    renderSurface({ isCompactViewport: false });

    expect(windowingEnabledAttribute()).toBe("true");
  });
});
