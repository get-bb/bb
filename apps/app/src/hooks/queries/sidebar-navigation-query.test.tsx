// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import {
  sidebarBootstrapResponseSchema,
  type SidebarBootstrapResponse,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { request } from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useSidebarNavigation } from "./sidebar-navigation-query";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, request: vi.fn() };
});

vi.mock("@/lib/api-server", () => ({
  apiClient: { "sidebar-bootstrap": { $get: vi.fn(() => ({})) } },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentListRealtimeSubscription: vi.fn(),
  useHostListRealtimeSubscription: vi.fn(),
  useProjectListRealtimeSubscription: vi.fn(),
  useThreadListRealtimeSubscription: vi.fn(),
}));

const PERSONAL_PROJECT: SidebarBootstrapResponse["personalProject"] = {
  id: "proj_personal",
  kind: "personal",
  name: "Personal",
  gitRemoteUrl: null,
  createdAt: 1,
  updatedAt: 1,
  sources: [],
  threads: [],
  defaultExecutionOptions: null,
};

const BOOTSTRAP: SidebarBootstrapResponse = {
  sections: [],
  projects: [
    {
      ...PERSONAL_PROJECT,
      id: "proj_felt",
      kind: "standard",
      name: "Felt walk",
    },
  ],
  personalProject: PERSONAL_PROJECT,
};

/** A request that never settles, so the pre-fetch render is observable. */
const pendingForever = () => new Promise<never>(() => {});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("useSidebarNavigation", () => {
  it("replays the last bootstrap while the live one loads", async () => {
    // The cache validates reads against the wire schema, so the fixture must
    // be a real response shape; fail here, not silently in the replay.
    sidebarBootstrapResponseSchema.parse(BOOTSTRAP);

    vi.mocked(request).mockResolvedValue(BOOTSTRAP);
    const warmHarness = createQueryClientTestHarness();
    const warm = renderHook(() => useSidebarNavigation(), {
      wrapper: warmHarness.wrapper,
    });
    await waitFor(() => expect(warm.result.current.data).toEqual(BOOTSTRAP));
    warm.unmount();

    // A full page load starts from an empty query cache; only the profile's
    // last-known bootstrap can fill the rail before the network answers.
    vi.mocked(request).mockImplementation(pendingForever);
    const reloadHarness = createQueryClientTestHarness();
    const { result } = renderHook(() => useSidebarNavigation(), {
      wrapper: reloadHarness.wrapper,
    });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.projects[0]?.name).toBe("Felt walk");
    await waitFor(() => expect(request).toHaveBeenCalled());
  });

  it("keeps the cold-profile skeleton: no placeholder without a stored bootstrap", () => {
    vi.mocked(request).mockImplementation(pendingForever);
    const harness = createQueryClientTestHarness();
    const { result } = renderHook(() => useSidebarNavigation(), {
      wrapper: harness.wrapper,
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPlaceholderData).toBe(false);
    expect(result.current.isPending).toBe(true);
  });
});
