// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { systemExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useMessageExecutionLabel } from "./message-execution-label";

vi.mock("@/lib/sdk", () => ({
  BbHttpError: class BbHttpError extends Error {},
  sdk: { providers: { list: vi.fn() } },
}));

const CODEX = makeProviderInfo({
  id: "codex",
  strings: {
    signInHint: "Sign in",
    expiredHint: "Expired",
    installUrl: "https://example.test",
    brandPrefix: "GPT-",
  },
  reasoningLevels: [{ id: "medium", label: "Medium effort" }],
});

const CATALOG: SystemExecutionOptionsResponse = {
  providers: [CODEX],
  models: [
    {
      id: "gpt-6.1-sol",
      model: "gpt-6.1-sol",
      displayName: "GPT-6.1-Sol",
      description: "",
      supportedReasoningEfforts: [],
      defaultReasoningEffort: "medium",
      isDefault: true,
    },
  ],
  selectedOnlyModels: [],
  permissionCeiling: "full",
  modelLoadError: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useMessageExecutionLabel", () => {
  it("formats the recorded model and reasoning like the model picker", async () => {
    vi.mocked(sdk.providers.list).mockResolvedValue([CODEX]);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(
      systemExecutionOptionsQueryKey({
        environmentId: "env_1",
        hostId: null,
        providerId: "codex",
      }),
      CATALOG,
    );

    const { result } = renderHook(
      () =>
        useMessageExecutionLabel({
          providerId: "codex",
          model: "gpt-6.1-sol",
          reasoningLevel: "medium",
        }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current).toEqual({
        model: "6.1-Sol",
        reasoning: "Medium effort",
      }),
    );
  });

  it("keeps the brand when the provider declares no brand prefix", async () => {
    vi.mocked(sdk.providers.list).mockResolvedValue([CODEX]);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(
      systemExecutionOptionsQueryKey({
        environmentId: null,
        hostId: null,
        providerId: "claude-code",
      }),
      CATALOG,
    );

    const { result } = renderHook(
      () =>
        useMessageExecutionLabel({
          providerId: "claude-code",
          model: "gpt-6.1-sol",
          reasoningLevel: "high",
        }),
      { wrapper },
    );

    await waitFor(() => expect(sdk.providers.list).toHaveBeenCalled());
    expect(result.current).toEqual({ model: "GPT-6.1-Sol", reasoning: "High" });
  });
});
