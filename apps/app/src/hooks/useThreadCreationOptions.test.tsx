// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";
import { useThreadCreationOptions } from "./useThreadCreationOptions";

const PROJECT_ID = "proj_prompt_defaults";
const GLOBAL_PROVIDER_ID = "global-provider";
const PROJECT_PROVIDER_ID = "project-provider";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSystemExecutionOptions: vi.fn(),
  };
});

function executionOptionsResponse(): SystemExecutionOptionsResponse {
  return {
    providers: [
      {
        id: GLOBAL_PROVIDER_ID,
        displayName: "Global Provider",
        available: true,
        capabilities: {
          supportsArchive: true,
          supportsRename: true,
          supportsServiceTier: true,
          supportsUserQuestion: true,
          supportedPermissionModes: ["readonly", "workspace-write", "full"],
        },
      },
      {
        id: PROJECT_PROVIDER_ID,
        displayName: "Project Provider",
        available: true,
        capabilities: {
          supportsArchive: true,
          supportsRename: true,
          supportsServiceTier: true,
          supportsUserQuestion: true,
          supportedPermissionModes: ["readonly", "workspace-write", "full"],
        },
      },
    ],
    models: [
      {
        id: "global-model",
        model: "global-model",
        displayName: "Global Model",
        description: "",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "" },
          { reasoningEffort: "high", description: "" },
        ],
        defaultReasoningEffort: "medium",
        isDefault: true,
      },
      {
        id: "project-model",
        model: "project-model",
        displayName: "Project Model",
        description: "",
        supportedReasoningEfforts: [
          { reasoningEffort: "medium", description: "" },
          { reasoningEffort: "high", description: "" },
        ],
        defaultReasoningEffort: "medium",
        isDefault: false,
      },
    ],
    selectedOnlyModels: [],
    modelLoadError: null,
  };
}

function setProjectScopedValue(baseKey: string, value: string): void {
  window.localStorage.setItem(
    getProjectScopedStorageKey(baseKey, PROJECT_ID),
    value,
  );
}

beforeEach(() => {
  vi.mocked(api.getSystemExecutionOptions).mockResolvedValue(
    executionOptionsResponse(),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("useThreadCreationOptions", () => {
  it("uses project-agnostic persisted defaults for new-thread prompt boxes", async () => {
    window.localStorage.setItem("bb.promptbox.provider", GLOBAL_PROVIDER_ID);
    window.localStorage.setItem("bb.promptbox.model", "global-model");
    window.localStorage.setItem("bb.promptbox.service-tier", "default");
    window.localStorage.setItem("bb.promptbox.reasoning", "high");
    window.localStorage.setItem(
      "bb.promptbox.permission-mode",
      "workspace-write",
    );
    window.localStorage.setItem(
      "bb.promptbox.environment",
      "host:global-host:worktree",
    );

    setProjectScopedValue("bb.promptbox.provider", PROJECT_PROVIDER_ID);
    setProjectScopedValue("bb.promptbox.model", "project-model");
    setProjectScopedValue("bb.promptbox.service-tier", "fast");
    setProjectScopedValue("bb.promptbox.reasoning", "low");
    setProjectScopedValue("bb.promptbox.permission-mode", "readonly");
    setProjectScopedValue("bb.promptbox.environment", "host:project-host:local");

    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          scope: "new-thread",
          initialProviderId: "initial-provider",
          initialModel: "initial-model",
          initialServiceTier: "fast",
          initialReasoningLevel: "medium",
          initialPermissionMode: "full",
          initialEnvironmentSelectionValue: "host:initial-host:local",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(api.getSystemExecutionOptions).toHaveBeenCalledWith({
        environmentId: undefined,
        providerId: GLOBAL_PROVIDER_ID,
      });
      expect(api.getSystemExecutionOptions).not.toHaveBeenCalledWith({
        environmentId: undefined,
        providerId: PROJECT_PROVIDER_ID,
      });
      expect(result.current.selectedProviderId).toBe(GLOBAL_PROVIDER_ID);
      expect(result.current.selectedModel).toBe("global-model");
      expect(result.current.serviceTier).toBe("default");
      expect(result.current.reasoningLevel).toBe("high");
      expect(result.current.permissionMode).toBe("workspace-write");
      expect(result.current.environmentSelectionValue).toBe(
        "host:global-host:worktree",
      );
    });
  });
});
