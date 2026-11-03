// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromptMentionCommandTrigger } from "@bb/domain";
import type { CommandListResponse } from "@bb/server-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useCommandSuggestions } from "./useCommandSuggestions";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    projects: {
      commands: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/useRealtimeSubscription", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useRealtimeSubscription")>()),
  useProjectDetailRealtimeSubscription: () => {},
}));

afterEach(() => {
  vi.clearAllMocks();
});

interface CommandQuery {
  trigger: PromptMentionCommandTrigger | null;
  text: string | null;
}

function renderCommandSuggestions() {
  const { wrapper } = createQueryClientTestHarness();
  const initialProps: CommandQuery = { trigger: null, text: null };
  return renderHook(
    ({ trigger, text }: CommandQuery) =>
      useCommandSuggestions({
        projectId: "project-1",
        providerId: "codex",
        commandScope: "thread",
        skillsTriggers: ["/", "$"],
        environmentId: "env-1",
        activeTrigger: trigger,
        query: text,
      }),
    { wrapper, initialProps },
  );
}

describe("useCommandSuggestions", () => {
  it("loads the catalog only once a command trigger is typed", async () => {
    const catalog = createDeferredPromise<CommandListResponse>();
    vi.mocked(sdk.projects.commands).mockReturnValue(catalog.promise);
    const { result, rerender } = renderCommandSuggestions();

    expect(sdk.projects.commands).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);

    rerender({ trigger: "/", text: "" });

    expect(sdk.projects.commands).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({
      isLoading: true,
      suggestions: [],
    });

    catalog.resolve({
      commands: [
        {
          name: "review",
          source: "command",
          origin: "user",
          description: null,
          argumentHint: null,
        },
      ],
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.suggestions.map(({ name }) => name)).toEqual([
      "review",
    ]);
  });
});
