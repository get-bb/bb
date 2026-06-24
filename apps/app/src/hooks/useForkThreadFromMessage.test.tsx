// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { Thread } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY,
  type ForkThreadCreateSeed,
} from "@/lib/fork-thread-request";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { useForkThreadFromMessage } from "./useForkThreadFromMessage";

const mocks = vi.hoisted(() => ({
  fetchQuery: vi.fn(),
  navigate: vi.fn(),
  setRootComposeProjectId: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({
      fetchQuery: mocks.fetchQuery,
    }),
  };
});

vi.mock("@/lib/root-compose-selection", () => ({
  useSetRootComposeProjectId: () => mocks.setRootComposeProjectId,
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  const base: Thread = {
    archivedAt: null,
    childOrigin: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "env_source",
    id: "thr_source",
    lastReadAt: null,
    latestAttentionAt: 1,
    originKind: null,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj_source",
    providerId: "codex",
    sourceThreadId: null,
    status: "idle",
    title: null,
    titleFallback: "Fallback fork title",
    folderId: null,
    updatedAt: 1,
  };
  return { ...base, ...overrides };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useForkThreadFromMessage", () => {
  it("opens the root composer with the source thread display title in the fork seed", async () => {
    mocks.fetchQuery.mockResolvedValue({
      model: "gpt-5",
      permissionMode: "workspace-write",
      reasoningLevel: "high",
      serviceTier: "fast",
    });

    const { result } = renderHook(() =>
      useForkThreadFromMessage({
        sourceThread: makeThread(),
      }),
    );

    await act(async () => {
      await result.current({ sourceSeqEnd: 12 });
    });

    expect(mocks.setRootComposeProjectId).toHaveBeenCalledWith("proj_source");
    expect(mocks.navigate).toHaveBeenCalledWith(getRootComposeRoutePath(), {
      state: expect.objectContaining({
        focusPrompt: true,
        reuseEnvironmentId: "env_source",
      }),
    });

    const navigateState = mocks.navigate.mock.calls[0]?.[1]?.state as
      | Record<string, unknown>
      | undefined;
    const seed = navigateState?.[
      FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY
    ] as ForkThreadCreateSeed | undefined;
    expect(seed).toMatchObject({
      environmentId: "env_source",
      model: "gpt-5",
      permissionMode: "workspace-write",
      projectId: "proj_source",
      providerId: "codex",
      reasoningLevel: "high",
      serviceTier: "fast",
      sourceSeqEnd: 12,
      sourceThreadId: "thr_source",
      sourceThreadTitle: "Fallback fork title",
    });
  });
});
