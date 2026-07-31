// @vitest-environment jsdom

/**
 * Round-trip guarantee of the `default*` seed props: submitting a seeded,
 * untouched composer must reproduce the request the seeds came from, and a
 * seed change after mount must re-seed even user-touched selections. This is
 * what lets a plugin store a `NewThreadRequest`, re-open it for editing, and
 * save without silently resetting the user's provider/model/permission/
 * environment to project defaults.
 */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewThreadRequest } from "@bb/plugin-sdk";
import { PluginNewThreadComposer } from "./PluginNewThreadComposer";

const mocks = vi.hoisted(() => ({
  promptBoxProps: [] as Array<Record<string, any>>,
}));

vi.mock("@/components/promptbox/NewThreadPromptBox", () => ({
  NewThreadPromptBox: (props: Record<string, unknown>) => {
    mocks.promptBoxProps.push(props);
    return <div data-testid="new-thread-prompt-box" />;
  },
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { projects: { attachments: { copy: vi.fn() } } },
}));

const PROJECT = {
  id: "proj_1",
  name: "Project One",
  defaultExecutionOptions: {
    providerId: "codex",
    model: "gpt-5.6",
    serviceTier: undefined,
    reasoningLevel: "medium",
    permissionMode: "auto",
  },
  sources: [
    {
      id: "src_1",
      projectId: "proj_1",
      type: "local_path",
      hostId: "host_1",
      path: "/repo",
      isDefault: true,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
};

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: { projects: [PROJECT], personalProject: undefined },
  }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: [{ id: "host_1", name: "Machine" }] }),
  selectPrimaryHost: (
    hosts: Array<{ id: string }> | undefined,
    primaryHostId: string | null,
  ) => hosts?.find((host) => host.id === primaryHostId) ?? hosts?.[0] ?? null,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: { primaryHostId: "host_1" } }),
  useSystemExecutionOptions: () => ({
    data: {
      providers: [
        {
          id: "codex",
          displayName: "Codex",
          logoUrl: null,
          capabilities: {
            supportsServiceTier: false,
            supportedPermissionModes: ["auto", "accept-edits", "full"],
          },
          composerActions: [],
        },
        {
          id: "claude-code",
          displayName: "Claude Code",
          logoUrl: null,
          capabilities: {
            supportsServiceTier: false,
            supportedPermissionModes: ["auto", "accept-edits", "full"],
          },
          composerActions: [],
        },
      ],
      models: [
        {
          model: "gpt-5.6",
          displayName: "GPT-5.6",
          isDefault: true,
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
        },
        {
          model: "gpt-5.6-sol",
          displayName: "GPT-5.6 Sol",
          isDefault: false,
          supportedReasoningEfforts: [
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
        },
      ],
      selectedOnlyModels: [],
      modelLoadError: null,
    },
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreads: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/queries/project-queries", () => ({
  stripProjectThreads: (project: unknown) => project,
  useProjectPromptHistory: () => ({ data: [] }),
  useProjectSourceBranches: () => ({
    data: {
      branches: ["main", "release"],
      branchesTruncated: false,
      checkout: { kind: "branch", branchName: "main" },
      defaultBranch: "main",
      defaultBranchRelation: null,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      originDefaultBranch: null,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
      defaultWorktreeBaseBranch: null,
    },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/project-default-execution-options-query", () => ({
  useProjectDefaultExecutionOptions: () => ({ data: undefined }),
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: () => ({
    triggers: [],
    suggestions: [],
    isLoading: false,
    isError: false,
    setQuery: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCommandSuggestions", () => ({
  useCommandSuggestions: () => ({
    trigger: null,
    suggestions: [],
    isLoading: false,
    isError: false,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
  }),
}));

function latestPromptBoxProps(): Record<string, any> {
  const props = mocks.promptBoxProps.at(-1);
  expect(props).toBeDefined();
  return props as Record<string, any>;
}

function renderComposer(
  seed: NewThreadRequest,
  onSubmit: (request: NewThreadRequest) => void,
  draftKey: string,
) {
  return render(
    <MemoryRouter>
      <PluginNewThreadComposer
        draftKey={draftKey}
        defaultProjectId={seed.projectId}
        defaultProviderId={seed.providerId}
        defaultModel={seed.model}
        defaultReasoningLevel={seed.reasoningLevel}
        defaultServiceTier={seed.serviceTier}
        defaultPermissionMode={seed.permissionMode}
        defaultEnvironment={seed.environment}
        initialPrompt="review every PR for slop"
        onSubmit={onSubmit}
      />
    </MemoryRouter>,
  );
}

const STORED_REQUEST: NewThreadRequest = {
  projectId: "proj_1",
  providerId: "claude-code",
  model: "gpt-5.6-sol",
  reasoningLevel: "high",
  permissionMode: "full",
  executionInputSources: {},
  environment: {
    type: "host",
    hostId: "host_1",
    workspace: {
      type: "managed-worktree",
      baseBranch: { kind: "named", name: "release" },
    },
  },
  input: [{ type: "text", text: "review every PR for slop", mentions: [] }],
};

async function submit(): Promise<void> {
  await act(async () => {
    latestPromptBoxProps().onSubmit();
  });
}

describe("PluginNewThreadComposer seeding", () => {
  beforeEach(() => {
    mocks.promptBoxProps.length = 0;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("round-trips a stored request submitted untouched", async () => {
    const submitted: NewThreadRequest[] = [];
    renderComposer(
      STORED_REQUEST,
      (request) => {
        submitted.push(request);
      },
      "round-trip",
    );

    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });
    await submit();

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual(STORED_REQUEST);
  });

  it("re-seeds every selection when the seed props change, even after a user pick", async () => {
    const submitted: NewThreadRequest[] = [];
    const view = renderComposer(
      STORED_REQUEST,
      (request) => {
        submitted.push(request);
      },
      "re-seed",
    );
    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });

    // The user touches the model, then switches to another saved record.
    await act(async () => {
      latestPromptBoxProps().execution.model.onChange("gpt-5.6");
    });
    const otherRecord: NewThreadRequest = {
      ...STORED_REQUEST,
      model: "gpt-5.6-sol",
      reasoningLevel: "medium",
      permissionMode: "accept-edits",
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: {
          type: "unmanaged",
          path: null,
          branch: { kind: "existing", name: "release" },
        },
      },
    };
    view.rerender(
      <MemoryRouter>
        <PluginNewThreadComposer
          draftKey="re-seed"
          defaultProjectId={otherRecord.projectId}
          defaultProviderId={otherRecord.providerId}
          defaultModel={otherRecord.model}
          defaultReasoningLevel={otherRecord.reasoningLevel}
          defaultServiceTier={otherRecord.serviceTier}
          defaultPermissionMode={otherRecord.permissionMode}
          defaultEnvironment={otherRecord.environment}
          initialPrompt="review every PR for slop"
          onSubmit={(request) => {
            submitted.push(request);
          }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });
    await submit();

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual(otherRecord);
  });

  it("keeps project defaults when no seed props are passed", async () => {
    const submitted: NewThreadRequest[] = [];
    render(
      <MemoryRouter>
        <PluginNewThreadComposer
          draftKey="unseeded"
          defaultProjectId="proj_1"
          initialPrompt="hello"
          onSubmit={(request) => {
            submitted.push(request);
          }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(latestPromptBoxProps().disabled).toBe(false);
    });
    await submit();

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({
      projectId: "proj_1",
      providerId: "codex",
      model: "gpt-5.6",
      reasoningLevel: "medium",
      permissionMode: "auto",
      environment: {
        type: "host",
        hostId: "host_1",
        workspace: { type: "unmanaged", path: null },
      },
    });
  });
});
