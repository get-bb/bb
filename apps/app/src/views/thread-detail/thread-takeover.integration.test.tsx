// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadWithRuntime } from "@bb/domain";
import { BringInModelDrawer } from "@/components/thread/BringInModelDrawer";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  navigate: vi.fn(),
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
    reset: vi.fn(),
  }),
}));

vi.mock("@/hooks/useThreadCreationOptions", () => ({
  useThreadCreationOptions: () => ({
    activeModel: { model: "gpt-5" },
    executionOptionsRouting: {},
    hasMultipleProviders: false,
    isLoadingModels: false,
    modelLoadError: null,
    modelLoadFailed: false,
    modelOptions: [],
    moreModelOptions: [],
    permissionMode: "auto",
    permissionModeOptions: [],
    providerOptions: [],
    reasoningLevel: "medium",
    reasoningOptions: [],
    selectedModel: "gpt-5",
    selectedProviderDisplayName: "Codex",
    selectedProviderId: "codex",
    serviceTier: undefined,
    serviceTierSupportByProvider: {},
    setPermissionMode: vi.fn(),
    setReasoningLevel: vi.fn(),
    setSelectedModel: vi.fn(),
    setSelectedProviderId: vi.fn(),
    setServiceTier: vi.fn(),
    supportsPermissionModeSelection: false,
    supportsServiceTier: false,
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
  }) => (open ? <div>{children}</div> : null),
  useResponsiveDrawerRealization: () => ({
    isContentRealized: true,
    realizeContent: vi.fn(),
  }),
}));

const thread: ThreadWithRuntime = {
  id: "thr_source",
  projectId: "proj_1",
  environmentId: "env_1",
  providerId: "codex",
  title: "Source",
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
} as ThreadWithRuntime;

describe("thread takeover integration", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.navigate.mockReset();
    mocks.mutateAsync.mockResolvedValue({
      sourceThreadId: "thr_source",
      replacementThreadId: "thr_replacement",
      state: "provisioning",
      sourceArchived: false,
      failure: null,
    });
  });

  it("navigates to the replacement as soon as the handoff POST succeeds", async () => {
    render(
      <BringInModelDrawer open onOpenChange={vi.fn()} thread={thread} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Take over this thread" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue with gpt-5" }));

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(
        "/projects/proj_1/threads/thr_replacement",
      );
    });
  });
});
