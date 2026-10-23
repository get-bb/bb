import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import {
  environmentFilePreviewQueryKey,
  systemExecutionOptionsQueryKey,
} from "./queries/query-keys";
import { removeEnvironmentScopedQueries } from "./cache-owners/environment-cache-effects";

interface ScopedSystemExecutionOptionsKeyArgs {
  environmentId: string;
}

function createCacheEffectQueryClient() {
  return createAppQueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
    showMutationErrorToasts: false,
  });
}

function scopedSystemExecutionOptionsKey({
  environmentId,
}: ScopedSystemExecutionOptionsKeyArgs) {
  return systemExecutionOptionsQueryKey({
    environmentId,
    hostId: null,
    providerId: "codex",
  });
}

const EMPTY_EXECUTION_OPTIONS = {
  providers: [],
  models: [],
  selectedOnlyModels: [],
  modelLoadError: null,
};

describe("environment cache effects", () => {
  it("removes env-scoped execution options caches on cleanup", () => {
    const queryClient = createCacheEffectQueryClient();
    const removedExecutionOptionsKey = scopedSystemExecutionOptionsKey({
      environmentId: "env-removed",
    });
    const retainedExecutionOptionsKey = scopedSystemExecutionOptionsKey({
      environmentId: "env-retained",
    });
    const removedFilePreviewKey = environmentFilePreviewQueryKey(
      "env-removed",
      "README.md",
      { kind: "working-tree" },
    );
    queryClient.setQueryData(
      removedExecutionOptionsKey,
      EMPTY_EXECUTION_OPTIONS,
    );
    queryClient.setQueryData(
      retainedExecutionOptionsKey,
      EMPTY_EXECUTION_OPTIONS,
    );
    queryClient.setQueryData(removedFilePreviewKey, {});

    removeEnvironmentScopedQueries({
      environmentId: "env-removed",
      queryClient,
    });

    expect(
      queryClient.getQueryData(removedExecutionOptionsKey),
    ).toBeUndefined();
    expect(queryClient.getQueryData(removedFilePreviewKey)).toBeUndefined();
    expect(queryClient.getQueryData(retainedExecutionOptionsKey)).toEqual(
      EMPTY_EXECUTION_OPTIONS,
    );
  });

});
