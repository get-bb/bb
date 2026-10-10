import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { prefetchCommandCatalog } from "./useCommandSuggestions";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    projects: {
      commands: vi.fn(),
    },
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("useCommandSuggestions catalog prefetch", () => {
  it("warms the command catalog for the composer's project, provider, and environment", async () => {
    vi.mocked(sdk.projects.commands).mockResolvedValue({ commands: [] });
    const { queryClient } = createQueryClientTestHarness();

    await prefetchCommandCatalog(queryClient, {
      projectId: "project-1",
      providerId: "codex",
      environmentId: "env-1",
      hostId: null,
    });

    expect(sdk.projects.commands).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sdk.projects.commands).mock.calls[0]?.[0]).toEqual({
      projectId: "project-1",
      provider: "codex",
      environmentId: "env-1",
      signal: expect.any(AbortSignal),
    });
  });
});
