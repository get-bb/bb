// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSetupComplete } from "./useSetupComplete";

const mocks = vi.hoisted(() => ({
  useSidebarNavigation: vi.fn(),
  useSystemConfig: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.useSystemConfig,
}));
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: mocks.useSidebarNavigation,
}));

function arrange({
  onboardingCompletedAt,
  threadCount,
}: {
  onboardingCompletedAt: string | null;
  threadCount: number;
}) {
  mocks.useSystemConfig.mockReturnValue({
    data: { generalSettings: { onboardingCompletedAt } },
  });
  mocks.useSidebarNavigation.mockReturnValue({
    data: {
      projects: [{ id: "proj_1", threads: [] }],
      personalProject: {
        threads: Array.from({ length: threadCount }, (_, index) => ({
          id: `thr_${index}`,
        })),
      },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSetupComplete", () => {
  it("is false until the setup guide is finished or skipped", () => {
    arrange({ onboardingCompletedAt: null, threadCount: 3 });

    expect(renderHook(() => useSetupComplete()).result.current).toBe(false);
  });

  it("is false after the guide until the first thread exists", () => {
    arrange({ onboardingCompletedAt: "2026-10-09T00:00:00.000Z", threadCount: 0 });

    expect(renderHook(() => useSetupComplete()).result.current).toBe(false);
  });

  it("is true once the guide is done and a thread exists", () => {
    arrange({ onboardingCompletedAt: "2026-10-09T00:00:00.000Z", threadCount: 1 });

    expect(renderHook(() => useSetupComplete()).result.current).toBe(true);
  });
});
