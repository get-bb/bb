// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { AvailableModel, PermissionMode } from "@bb/domain";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { createTestSystemProvider } from "@/test/system-provider-test-utils";
import { useThreadCreationOptions } from "./useThreadCreationOptions";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    getSystemExecutionOptions: vi.fn(),
    listSystemProviders: vi.fn(),
  };
});

interface ModelOverrides extends Partial<AvailableModel> {}

const PERMISSION_MODE_OPTIONS = [
  {
    value: "full",
    label: "Full Access",
    tone: "warning",
  },
  {
    value: "workspace-write",
    label: "Workspace Write",
  },
  {
    value: "readonly",
    label: "Readonly",
  },
] as const;

function makeModel(overrides: ModelOverrides = {}): AvailableModel {
  return {
    defaultReasoningEffort: "medium",
    description: "Model description",
    displayName: "gpt-5.4",
    id: "model-id",
    isDefault: true,
    model: "gpt-5.4",
    supportedReasoningEfforts: [
      {
        description: "Low effort",
        reasoningEffort: "low",
      },
      {
        description: "Medium effort",
        reasoningEffort: "medium",
      },
    ],
    ...overrides,
  };
}

function mockExecutionOptions({
  modelLoadError = null,
  models,
  providers,
  selectedOnlyModels = [],
}: {
  modelLoadError?: SystemExecutionOptionsModelLoadError | null;
  models: AvailableModel[];
  providers: ReturnType<typeof createTestSystemProvider>[];
  selectedOnlyModels?: AvailableModel[];
}): void {
  vi.mocked(api.getSystemExecutionOptions).mockResolvedValue({
    models,
    providers,
    selectedOnlyModels,
    modelLoadError,
  });
}

interface ThreadCreationOptionsHookProps {
  initialPermissionMode?: PermissionMode;
  resetKey: string;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("useThreadCreationOptions", () => {
  it("does not load provider or model options while disabled", () => {
    const { wrapper } = createQueryClientTestHarness();
    renderHook(
      () =>
        useThreadCreationOptions({
          enabled: false,
          initialProviderId: "codex",
          projectId: "project-disabled-options",
          scope: "component-local",
        }),
      { wrapper },
    );

    expect(api.listSystemProviders).not.toHaveBeenCalled();
    expect(api.getSystemExecutionOptions).not.toHaveBeenCalled();
  });

  it("does not load hostless execution options for a thread without an environment", () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          initialProviderId: "codex",
          projectId: "project-thread-without-environment",
          scope: "component-local",
        }),
      { wrapper },
    );

    expect(result.current.providerOptions).toEqual([]);
    expect(api.getSystemExecutionOptions).not.toHaveBeenCalled();
  });

  it("marks stored create selections as client preferences", async () => {
    const projectId = "project-stored-source";
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.provider", projectId),
      "codex",
    );
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.model", projectId),
      "gpt-5.4",
    );
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.reasoning", projectId),
      "medium",
    );
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.permission-mode", projectId),
      "workspace-write",
    );
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.service-tier", projectId),
      "fast",
    );

    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          capabilities: {
            supportsServiceTier: true,
          },
          id: "codex",
        }),
      ],
      models: [
        makeModel({
          id: "gpt-5.4",
          model: "gpt-5.4",
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          projectId,
          scope: "new-thread",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("codex");
      expect(result.current.selectedModel).toBe("gpt-5.4");
      expect(result.current.serviceTier).toBe("fast");
    });

    expect(result.current.executionInputSources).toEqual({
      providerId: "client-preference",
      model: "client-preference",
      serviceTier: "client-preference",
      reasoningLevel: "client-preference",
      permissionMode: "client-preference",
    });
  });

  it("falls back to valid provider and model values from query data", async () => {
    const projectId = "project-1";
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.provider", projectId),
      "missing",
    );
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.model", projectId),
      "missing-model",
    );
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.reasoning", projectId),
      "xhigh",
    );
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.service-tier", projectId),
      "fast",
    );

    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          capabilities: {
            supportsServiceTier: false,
          },
          displayName: "Codex",
          id: "codex",
        }),
      ],
      models: [
        makeModel({
          defaultReasoningEffort: "low",
          displayName: "gpt-5.4",
          id: "gpt-5.4",
          model: "gpt-5.4",
          supportedReasoningEfforts: [
            {
              description: "Low effort",
              reasoningEffort: "low",
            },
            {
              description: "Medium effort",
              reasoningEffort: "medium",
            },
          ],
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          projectId,
          scope: "new-thread",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("codex");
    });

    expect(result.current.selectedModel).toBe("gpt-5.4");
    // Stored level was "xhigh"; this model supports only ["low","medium"]. The
    // reconcile policy picks the closest level by rank distance (xhigh→medium
    // is distance 2; xhigh→low is distance 3), not the model's default.
    expect(result.current.reasoningLevel).toBe("medium");
    expect(result.current.permissionMode).toBe("full");
    expect(result.current.permissionModeOptions).toEqual(
      PERMISSION_MODE_OPTIONS,
    );
    expect(result.current.serviceTier).toBeUndefined();
    expect(result.current.supportsServiceTier).toBe(false);
  });

  it("filters permission modes by provider capabilities and falls back to full", async () => {
    const projectId = "project-pi";
    localStorage.setItem(
      getProjectScopedStorageKey("bb.promptbox.permission-mode", projectId),
      "readonly",
    );

    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          capabilities: {
            supportsArchive: false,
            supportsRename: false,
            supportsServiceTier: false,
            supportsUserQuestion: false,
            supportedPermissionModes: ["full"],
          },
          displayName: "Pi",
          id: "pi",
        }),
      ],
      models: [
        makeModel({
          displayName: "pi",
          id: "pi",
          model: "pi",
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          projectId,
          scope: "new-thread",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("pi");
    });

    expect(result.current.permissionMode).toBe("full");
    expect(result.current.supportsPermissionModeSelection).toBe(false);
    expect(result.current.permissionModeOptions).toEqual([
      PERMISSION_MODE_OPTIONS[0],
    ]);
  });

  it("exposes the model load error from execution options", async () => {
    const modelLoadError: SystemExecutionOptionsModelLoadError = {
      providerId: "codex",
      code: "missing_executable",
    };
    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          displayName: "Codex",
          id: "codex",
        }),
      ],
      models: [],
      modelLoadError,
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          projectId: "project-model-load-error",
          scope: "new-thread",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("codex");
    });

    expect(result.current.modelLoadError).toEqual(modelLoadError);
  });

  it("persists new-thread selections to project-scoped local storage", async () => {
    const projectId = "project-storage";

    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          capabilities: {
            supportsServiceTier: true,
          },
          id: "codex",
        }),
      ],
      models: [
        makeModel({
          id: "gpt-5.4",
          model: "gpt-5.4",
        }),
        makeModel({
          defaultReasoningEffort: "high",
          displayName: "gpt-5.4-mini",
          id: "gpt-5.4-mini",
          isDefault: false,
          model: "gpt-5.4-mini",
          supportedReasoningEfforts: [
            {
              description: "Medium effort",
              reasoningEffort: "medium",
            },
            {
              description: "High effort",
              reasoningEffort: "high",
            },
          ],
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          projectId,
          scope: "new-thread",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("gpt-5.4");
    });

    act(() => {
      result.current.setSelectedModel("gpt-5.4-mini");
      result.current.setReasoningLevel("high");
      result.current.setPermissionMode("workspace-write");
      result.current.setServiceTier("fast");
      result.current.setEnvironmentSelectionValue("worktree");
    });

    await waitFor(() => {
      expect(
        localStorage.getItem(
          getProjectScopedStorageKey("bb.promptbox.model", projectId),
        ),
      ).toBe("gpt-5.4-mini");
    });

    expect(
      localStorage.getItem(
        getProjectScopedStorageKey("bb.promptbox.reasoning", projectId),
      ),
    ).toBe("high");
    expect(
      localStorage.getItem(
        getProjectScopedStorageKey("bb.promptbox.permission-mode", projectId),
      ),
    ).toBe("workspace-write");
    expect(
      localStorage.getItem(
        getProjectScopedStorageKey("bb.promptbox.service-tier", projectId),
      ),
    ).toBe("fast");
    expect(
      localStorage.getItem(
        getProjectScopedStorageKey("bb.promptbox.environment", projectId),
      ),
    ).toBe("worktree");
    expect(result.current.executionInputSources).toEqual({
      model: "explicit",
      serviceTier: "explicit",
      reasoningLevel: "explicit",
      permissionMode: "explicit",
    });
  });

  it("adopts late-arriving initial values for new-thread scope with empty storage", async () => {
    // Regression: on a fresh load with no localStorage, RootComposeView fetches
    // the project's default execution options asynchronously. Before the fix,
    // the picker would display the system-wide first-provider/default-model
    // (e.g. Codex / gpt-5.5) while the server fell back to the project's
    // stored provider on submit, producing a thread created with the wrong
    // provider. The picker must now reflect the project default once it
    // resolves so the visible selection matches what the server will use,
    // and so a user pick is marked "explicit" against the right baseline.
    const projectId = "project-late-initial";

    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          id: "codex",
        }),
        createTestSystemProvider({
          id: "claude-code",
          displayName: "Claude Code",
        }),
      ],
      models: [
        makeModel({
          id: "claude-fable-5",
          model: "claude-fable-5",
          displayName: "Claude Fable 5",
        }),
      ],
    });

    interface LateInitialProps {
      initialProviderId?: string;
      initialModel?: string;
    }
    const initialProps: LateInitialProps = {
      initialProviderId: undefined,
      initialModel: undefined,
    };
    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({ initialProviderId, initialModel }: LateInitialProps) =>
        useThreadCreationOptions({
          projectId,
          scope: "new-thread",
          initialProviderId,
          initialModel,
        }),
      { initialProps, wrapper },
    );

    rerender({
      initialProviderId: "claude-code",
      initialModel: "claude-fable-5",
    });

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("claude-code");
      expect(result.current.selectedModel).toBe("claude-fable-5");
    });
    // Untouched fields seeded from late-arriving defaults are not "client
    // preferences" — the user hasn't expressed a preference and the values
    // aren't persisted. The server will resolve the same defaults on submit.
    expect(result.current.executionInputSources).toEqual({});
  });

  it("preserves touched thread selections until the reset key changes", async () => {
    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          id: "codex",
        }),
      ],
      models: [
        makeModel({
          id: "gpt-5.4",
          isDefault: true,
          model: "gpt-5.4",
        }),
        makeModel({
          defaultReasoningEffort: "high",
          displayName: "gpt-5.4-mini",
          id: "gpt-5.4-mini",
          isDefault: false,
          model: "gpt-5.4-mini",
          supportedReasoningEfforts: [
            {
              description: "Medium effort",
              reasoningEffort: "medium",
            },
            {
              description: "High effort",
              reasoningEffort: "high",
            },
          ],
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result, rerender } = renderHook(
      ({
        initialModel,
        resetKey,
      }: {
        initialModel: string;
        resetKey: string;
      }) =>
        useThreadCreationOptions({
          environmentId: "environment-thread",
          initialModel,
          initialProviderId: "codex",
          projectId: "project-thread",
          resetKey,
          scope: "component-local",
        }),
      {
        initialProps: {
          initialModel: "gpt-5.4",
          resetKey: "thread-1",
        },
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("gpt-5.4");
    });

    act(() => {
      result.current.setSelectedModel("gpt-5.4-mini");
    });

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("gpt-5.4-mini");
    });

    rerender({
      initialModel: "gpt-5.4",
      resetKey: "thread-1",
    });

    expect(result.current.selectedModel).toBe("gpt-5.4-mini");

    rerender({
      initialModel: "gpt-5.4",
      resetKey: "thread-2",
    });

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("gpt-5.4");
    });
  });

  it("uses arriving component-local permission defaults before effect state sync", async () => {
    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          id: "codex",
        }),
      ],
      models: [
        makeModel({
          id: "gpt-5.4",
          model: "gpt-5.4",
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const initialProps: ThreadCreationOptionsHookProps = {
      resetKey: "thread-1",
    };
    const renderedPermissionModes: PermissionMode[] = [];
    const { result, rerender } = renderHook(
      ({ initialPermissionMode, resetKey }: ThreadCreationOptionsHookProps) => {
        const options = useThreadCreationOptions({
          environmentId: "environment-probe",
          initialPermissionMode,
          initialProviderId: "codex",
          projectId: "project-probe",
          resetKey,
          scope: "component-local",
        });
        renderedPermissionModes.push(options.permissionMode);
        return options;
      },
      {
        initialProps,
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.permissionModeOptions).toEqual(
        PERMISSION_MODE_OPTIONS,
      );
    });
    expect(result.current.permissionMode).toBe("full");

    renderedPermissionModes.length = 0;
    rerender({
      initialPermissionMode: "workspace-write",
      resetKey: "thread-1",
    });

    expect(renderedPermissionModes[0]).toBe("workspace-write");
    expect(result.current.permissionMode).toBe("workspace-write");

    renderedPermissionModes.length = 0;
    rerender({
      initialPermissionMode: "readonly",
      resetKey: "thread-2",
    });

    expect(renderedPermissionModes[0]).toBe("readonly");
    expect(result.current.permissionMode).toBe("readonly");
  });

  it("marks component-local execution sources explicit only after execution controls change", async () => {
    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          capabilities: {
            supportsServiceTier: true,
          },
          id: "codex",
        }),
      ],
      models: [
        makeModel({
          id: "gpt-5",
          model: "gpt-5",
          supportedReasoningEfforts: [
            {
              description: "Medium effort",
              reasoningEffort: "medium",
            },
            {
              description: "High effort",
              reasoningEffort: "high",
            },
          ],
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          environmentId: "env-component-local-sources",
          initialModel: "gpt-5",
          initialPermissionMode: "full",
          initialProviderId: "codex",
          initialReasoningLevel: "medium",
          initialServiceTier: "default",
          projectId: "project-component-local-sources",
          resetKey: "thread-component-local-sources",
          scope: "component-local",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("gpt-5");
    });

    expect(result.current.executionInputSources).toEqual({});

    act(() => {
      result.current.setReasoningLevel("high");
    });

    expect(result.current.executionInputSources).toEqual({
      model: "explicit",
      serviceTier: "explicit",
      reasoningLevel: "explicit",
      permissionMode: "explicit",
    });
  });

  it("preserves touched component-local permission mode until the reset key changes", async () => {
    mockExecutionOptions({
      providers: [
        createTestSystemProvider({
          id: "codex",
        }),
      ],
      models: [
        makeModel({
          id: "gpt-5.4",
          model: "gpt-5.4",
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const renderedPermissionModes: PermissionMode[] = [];
    const { result, rerender } = renderHook(
      ({ initialPermissionMode, resetKey }: ThreadCreationOptionsHookProps) => {
        const options = useThreadCreationOptions({
          environmentId: "environment-probe",
          initialPermissionMode,
          initialProviderId: "codex",
          projectId: "project-probe",
          resetKey,
          scope: "component-local",
        });
        renderedPermissionModes.push(options.permissionMode);
        return options;
      },
      {
        initialProps: {
          initialPermissionMode: "full",
          resetKey: "thread-1",
        },
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.permissionModeOptions).toEqual(
        PERMISSION_MODE_OPTIONS,
      );
    });
    expect(result.current.permissionMode).toBe("full");

    act(() => {
      result.current.setPermissionMode("readonly");
    });

    await waitFor(() => {
      expect(result.current.permissionMode).toBe("readonly");
    });

    renderedPermissionModes.length = 0;
    rerender({
      initialPermissionMode: "workspace-write",
      resetKey: "thread-1",
    });

    expect(renderedPermissionModes[0]).toBe("readonly");
    expect(result.current.permissionMode).toBe("readonly");

    renderedPermissionModes.length = 0;
    rerender({
      initialPermissionMode: "workspace-write",
      resetKey: "thread-2",
    });

    expect(renderedPermissionModes[0]).toBe("workspace-write");
    expect(result.current.permissionMode).toBe("workspace-write");
  });

  it("switches to the new provider default model when the provider changes", async () => {
    const providers = [
      createTestSystemProvider({
        displayName: "Codex",
        id: "codex",
      }),
      createTestSystemProvider({
        capabilities: {
          supportsArchive: false,
        },
        displayName: "Claude Code",
        id: "claude-code",
      }),
    ];
    vi.mocked(api.getSystemExecutionOptions).mockImplementation(
      async ({ providerId }) => ({
        providers,
        models:
          providerId === "claude-code"
            ? [
                makeModel({
                  defaultReasoningEffort: "high",
                  displayName: "Claude Sonnet 4.6",
                  id: "claude-sonnet-4-6",
                  model: "claude-sonnet-4-6",
                }),
              ]
            : [
                makeModel({
                  displayName: "gpt-5.4",
                  id: "gpt-5.4",
                  model: "gpt-5.4",
                }),
              ],
        selectedOnlyModels: [],
        modelLoadError: null,
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          projectId: "project-switch",
          scope: "new-thread",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("codex");
    });

    act(() => {
      result.current.setSelectedProviderId("claude-code");
    });

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("claude-code");
    });

    await waitFor(() => {
      expect(result.current.selectedModel).toBe("claude-sonnet-4-6");
    });

    // modelOptions carries the case-normalised raw label; the brand-prefix
    // strip ("Claude " / "GPT-") is a render-time rule applied by the picker,
    // not a data transform here. See `stripModelBrandPrefix`.
    expect(result.current.modelOptions).toEqual([
      {
        label: "Claude Sonnet 4.6",
        value: "claude-sonnet-4-6",
      },
    ]);
  });

  it("prepends a retired model from the selected-only pool when it is the user's stored selection", async () => {
    mockExecutionOptions({
      providers: [createTestSystemProvider({ id: "claude-code" })],
      models: [
        makeModel({
          displayName: "Opus 4.7",
          id: "claude-opus-4-7",
          isDefault: true,
          model: "claude-opus-4-7",
        }),
      ],
      selectedOnlyModels: [
        makeModel({
          displayName: "Opus Alias (Legacy)",
          id: "opus",
          isDefault: false,
          model: "opus",
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          environmentId: "environment-selected-only",
          initialModel: "opus",
          initialProviderId: "claude-code",
          projectId: "project-selected-only",
          scope: "component-local",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.modelOptions.length).toBeGreaterThan(0);
    });

    expect(result.current.selectedModel).toBe("opus");
    expect(result.current.modelOptions[0]).toEqual({
      label: "Opus Alias (Legacy)",
      value: "opus",
    });
    expect(result.current.modelOptions.map((option) => option.value)).toEqual([
      "opus",
      "claude-opus-4-7",
    ]);
  });

  it("ignores selectedOnlyModels when the stored selection is already active", async () => {
    mockExecutionOptions({
      providers: [createTestSystemProvider({ id: "claude-code" })],
      models: [
        makeModel({
          displayName: "Opus 4.7",
          id: "claude-opus-4-7",
          isDefault: true,
          model: "claude-opus-4-7",
        }),
      ],
      selectedOnlyModels: [
        makeModel({
          displayName: "Opus Alias (Legacy)",
          id: "opus",
          isDefault: false,
          model: "opus",
        }),
      ],
    });

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadCreationOptions({
          environmentId: "environment-active",
          initialModel: "claude-opus-4-7",
          initialProviderId: "claude-code",
          projectId: "project-active",
          scope: "component-local",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.modelOptions.length).toBeGreaterThan(0);
    });

    expect(result.current.selectedModel).toBe("claude-opus-4-7");
    expect(result.current.modelOptions.map((option) => option.value)).toEqual([
      "claude-opus-4-7",
    ]);
  });
});
