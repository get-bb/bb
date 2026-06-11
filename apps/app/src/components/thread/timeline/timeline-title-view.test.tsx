// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type {
  TimelineTitle,
  TimelineTitleAction,
  TimelineTitleDecoration,
  TimelineTitleSegment,
} from "@bb/thread-view";
import { TimelineTitleView } from "@/components/thread/timeline/TimelineTitleView";
import { AppRouteNavigationProvider } from "@/components/ui/app-route-anchor";

interface TitleArgs {
  segments: TimelineTitleSegment[];
  decorations?: TimelineTitleDecoration[];
  tone?: TimelineTitle["tone"];
  action?: TimelineTitleAction | null;
  plain?: string;
}

interface LocationProbeProps {
  label: string;
}

function classTokens(element: HTMLElement): Set<string> {
  return new Set(element.className.split(/\s+/).filter(Boolean));
}

function title({
  segments,
  decorations = [],
  tone = "default",
  action = null,
  plain,
}: TitleArgs): TimelineTitle {
  return {
    segments,
    decorations,
    tone,
    action,
    plain: plain ?? segments.map((s) => s.text).join(" "),
  };
}

function seg(
  text: string,
  opts: Partial<Omit<TimelineTitleSegment, "text">> = {},
): TimelineTitleSegment {
  return {
    text,
    em: opts.em ?? false,
    shimmer: opts.shimmer ?? false,
    truncate: opts.truncate ?? false,
    ...(opts.plainText !== undefined ? { plainText: opts.plainText } : {}),
  };
}

const fileDiffAction: TimelineTitleAction = {
  kind: "open-file-diff",
  path: "src/foo.ts",
};

function LocationProbe({ label }: LocationProbeProps) {
  const location = useLocation();
  return (
    <span data-testid={label}>
      {location.pathname}
      {location.search}
      {location.hash}
    </span>
  );
}

afterEach(() => {
  cleanup();
});

describe("TimelineTitleView", () => {
  it("invokes the resolved callback on Enter and Space keypress", () => {
    const onAction = vi.fn();
    render(
      <TimelineTitleView
        title={title({
          segments: [seg("src/foo.ts", { em: true, truncate: true })],
          action: fileDiffAction,
        })}
        onTitleAction={() => onAction}
      />,
    );

    const link = screen.getByRole("link", { name: /src\/foo\.ts/ });
    fireEvent.keyDown(link, { key: "Enter" });
    fireEvent.keyDown(link, { key: " " });

    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("ticks live duration forward without re-rendering from the server", () => {
    vi.useFakeTimers();
    try {
      // Pretend the work started 2.1s ago: pin a fake "now" and put startedAt
      // 2_100ms before it. LiveDurationText reads `Date.now() - startedAt`.
      const fakeNow = 1_000_000;
      vi.setSystemTime(fakeNow);
      const startedAt = fakeNow - 2_100;
      const liveTitle = title({
        segments: [
          seg("Running", { shimmer: true }),
          seg("pnpm test", { em: true, truncate: true }),
        ],
        decorations: [
          { kind: "duration", startedAt, completedAt: null, em: false },
        ],
      });

      render(<TimelineTitleView title={liveTitle} />);

      expect(screen.getByText("2s")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(3_000);
      });

      // 2.1s baseline + 3s tick = 5.1s, formatted as "5s"
      expect(screen.getByText("5s")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops click and keyboard propagation so the surrounding row header doesn't toggle", () => {
    const onAction = vi.fn();
    const onWrapperClick = vi.fn();
    const onWrapperKeyDown = vi.fn();

    render(
      <MemoryRouter>
        <AppRouteNavigationProvider>
          <div onClick={onWrapperClick} onKeyDown={onWrapperKeyDown}>
            <TimelineTitleView
              title={title({
                segments: [seg("src/foo.ts", { em: true, truncate: true })],
                action: fileDiffAction,
              })}
              onTitleAction={() => onAction}
            />
          </div>
        </AppRouteNavigationProvider>
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: /src\/foo\.ts/ });
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: "Enter" });

    expect(onAction).toHaveBeenCalledTimes(2);
    expect(onWrapperClick).not.toHaveBeenCalled();
    expect(onWrapperKeyDown).not.toHaveBeenCalled();
  });

  it("stops link click propagation so the row header doesn't toggle", () => {
    const onWrapperClick = vi.fn();

    render(
      <MemoryRouter>
        <AppRouteNavigationProvider>
          <div onClick={onWrapperClick}>
            <TimelineTitleView
              title={title({
                segments: [
                  {
                    text: "Parent thread",
                    em: true,
                    shimmer: false,
                    truncate: true,
                    link: { kind: "thread", threadId: "thr_parent" },
                  },
                ],
              })}
              resolveSegmentLinkHref={() => "/projects/p/threads/thr_parent"}
            />
          </div>
        </AppRouteNavigationProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Parent thread" }));

    expect(onWrapperClick).not.toHaveBeenCalled();
  });

  it("routes segment links through client-side navigation", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRouteNavigationProvider>
          <TimelineTitleView
            title={title({
              segments: [
                {
                  text: "Parent thread",
                  em: true,
                  shimmer: false,
                  truncate: true,
                  link: { kind: "thread", threadId: "thr_parent" },
                },
              ],
            })}
            resolveSegmentLinkHref={() =>
              "/projects/proj_1/threads/thr_parent?panel=timeline#row"
            }
          />
          <LocationProbe label="location" />
        </AppRouteNavigationProvider>
      </MemoryRouter>,
    );

    const notDefaultPrevented = fireEvent.click(
      screen.getByRole("link", { name: "Parent thread" }),
    );

    expect(notDefaultPrevented).toBe(false);
    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/proj_1/threads/thr_parent?panel=timeline#row",
    );
  });

  it("renders emphasized tool titles at medium weight", () => {
    render(
      <TimelineTitleView
        title={title({
          segments: [seg("pnpm test", { em: true })],
        })}
      />,
    );

    expect(classTokens(screen.getByText("pnpm test")).has("font-medium")).toBe(
      true,
    );
  });
});
