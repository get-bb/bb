// @vitest-environment jsdom

import type { ReactNode } from "react";
import type { ThreadWithRuntime } from "@bb/domain";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BringInModelDrawer } from "./BringInModelDrawer";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  navigate: vi.fn(),
  reset: vi.fn(),
  setSelectedModel: vi.fn(),
  setSelectedProviderId: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/hooks/mutations/thread-handoff-mutations", () => ({
  useThreadHandoff: () => ({
    isPending: false,
    mutateAsync: mocks.mutateAsync,
    reset: mocks.reset,
  }),
}));

vi.mock("@/hooks/useThreadCreationOptions", () => ({
  useThreadCreationOptions: () => ({
    activeModel: { model: "claude-opus-5" },
    executionOptionsRouting: {},
    hasMultipleProviders: true,
    isLoadingModels: false,
    modelLoadError: null,
    modelLoadFailed: false,
    modelOptions: [],
    moreModelOptions: [],
    permissionMode: "auto",
    permissionModeOptions: [{ value: "auto", label: "Auto" }],
    providerOptions: [],
    reasoningLevel: "high",
    reasoningOptions: [],
    selectedModel: "claude-opus-5",
    selectedProviderDisplayName: "Claude Code",
    selectedProviderId: "claudeCode",
    serviceTier: "fast",
    serviceTierSupportByProvider: {},
    setPermissionMode: vi.fn(),
    setReasoningLevel: vi.fn(),
    setSelectedModel: mocks.setSelectedModel,
    setSelectedProviderId: mocks.setSelectedProviderId,
    setServiceTier: vi.fn(),
    supportsPermissionModeSelection: true,
    supportsServiceTier: true,
  }),
}));

vi.mock("@/components/promptbox/ExecutionControls", () => ({
  ExecutionControls: () => <div data-testid="execution-controls" />,
}));

vi.mock("@bb/shared-ui/responsive-overlay", () => ({
  PersistentResponsiveDrawerShell: ({
    children,
    open,
  }: {
    children: ReactNode;
    open: boolean;
  }) => (open ? <div data-testid="bring-in-model-shell">{children}</div> : null),
  useResponsiveDrawerRealization: () => ({
    isContentRealized: true,
    realizeContent: vi.fn(),
  }),
}));

function makeThread(
  overrides: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return {
    id: "thr_source",
    projectId: "proj_1",
    environmentId: "env_1",
    providerId: "codex",
    title: "Source thread",
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    runtime: { displayStatus: "idle" },
    ...overrides,
  } as ThreadWithRuntime;
}

describe("BringInModelDrawer", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.navigate.mockReset();
    mocks.reset.mockReset();
    mocks.mutateAsync.mockResolvedValue({
      sourceThreadId: "thr_source",
      replacementThreadId: "thr_replacement",
      state: "provisioning",
      sourceArchived: false,
      failure: null,
    });
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    });
  });

  it("starts a takeover with a stable idempotency key and navigates to the replacement", async () => {
    render(
      <BringInModelDrawer
        open
        onOpenChange={vi.fn()}
        thread={makeThread()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Review this work" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(
      screen.getByRole("button", { name: "Take over this thread" }),
    );
    expect(screen.getByTestId("execution-controls")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with claude-opus-5" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with claude-opus-5" }),
    );

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(2);
    });
    expect(mocks.mutateAsync).toHaveBeenNthCalledWith(1, {
      archiveSource: true,
      idempotencyKey: "app-handoff-11111111-1111-4111-8111-111111111111",
      model: "claude-opus-5",
      permissionMode: "auto",
      providerId: "claudeCode",
      reasoningLevel: "high",
      serviceTier: "fast",
      sourceThreadId: "thr_source",
    });
    expect(mocks.mutateAsync.mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: "app-handoff-11111111-1111-4111-8111-111111111111",
    });
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(
        "/projects/proj_1/threads/thr_replacement",
      );
    });
  });
});
