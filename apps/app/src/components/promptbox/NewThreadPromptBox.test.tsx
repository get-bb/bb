// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { Host, PermissionMode, ProjectSource } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { restoreMatchMedia, setupMatchMedia } from "@/test/helpers/match-media";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@/components/ui/hooks/use-pointer-coarse";
import {
  NewThreadPromptBoxUI,
  type NewThreadModeConfig,
} from "./NewThreadPromptBox";

const noop = vi.fn();

interface TestProviderIconProps {
  className?: string;
}

const localHostId = "host_local";

const localHost: Host = {
  id: localHostId,
  name: "localhost",
  type: "persistent",
  status: "connected",
  lastSeenAt: 0,
  createdAt: 0,
  updatedAt: 0,
};

const projectSources: readonly ProjectSource[] = [
  {
    id: "src_local",
    projectId: "proj_bb",
    type: "local_path",
    hostId: localHostId,
    path: "/Users/michael/Projects/bb",
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

const permissionModeOptions: readonly {
  value: PermissionMode;
  label: string;
}[] = [
  { value: "workspace-write", label: "Workspace Write" },
  { value: "full", label: "Full" },
];

function TestProviderIcon({ className }: TestProviderIconProps) {
  return <svg className={className} aria-hidden />;
}

function buildThreadModeConfig(): NewThreadModeConfig {
  return {
    environment: {
      value: `host:${localHostId}:local`,
      onChange: noop,
      sources: projectSources,
      host: localHost,
      isLocal: true,
    },
    branch: {
      value: null,
      currentBranch: "main",
      isNew: false,
      options: ["main"],
      onChange: noop,
      onCreate: noop,
    },
    worktree: {
      options: [],
      value: null,
      onChange: noop,
    },
    permission: {
      value: "workspace-write",
      options: permissionModeOptions,
      onChange: noop,
      supported: true,
    },
  };
}

function renderNewThreadPrompt(modeConfig: NewThreadModeConfig): void {
  const { wrapper } = createQueryClientTestHarness();

  render(
    <NewThreadPromptBoxUI
      value=""
      mentionRanges={[]}
      onChange={noop}
      onSubmit={noop}
      isSubmitting={false}
      disabled={false}
      zenModeStorageKey="bb.test.new-thread"
      history={{
        currentDraft: { text: "", mentions: [], attachments: [] },
        entries: [],
        onSelectEntry: noop,
      }}
      typeahead={{
        mention: {
          suggestions: [],
          isLoading: false,
          isError: false,
          onQueryChange: noop,
        },
        command: {
          trigger: null,
          suggestions: [],
          isLoading: false,
          isError: false,
          onQueryChange: noop,
        },
      }}
      attachments={{ items: [] }}
      modeConfig={modeConfig}
      project={{
        projects: [{ id: "proj_bb", name: "bb" }],
        value: null,
        onChange: noop,
        allowNoProject: true,
      }}
      execution={{
        provider: {
          selectedId: "codex",
          hasMultiple: false,
          options: [{ value: "codex", label: "Codex", icon: TestProviderIcon }],
        },
        model: {
          selected: "gpt-5",
          options: [{ value: "gpt-5", label: "GPT-5" }],
          onChange: noop,
        },
        reasoning: { value: "medium", options: [], onChange: noop },
      }}
    />,
    { wrapper },
  );
}

function setupCompactViewport() {
  setupMatchMedia({
    matchesByQuery: new Map([[COMPACT_VIEWPORT_QUERY, true]]),
  });
}

function setupCoarsePointerViewport() {
  setupMatchMedia({
    matchesByQuery: new Map([[POINTER_COARSE_QUERY, true]]),
  });
}

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

afterEach(() => {
  cleanup();
  restoreMatchMedia();
  noop.mockClear();
});

describe("NewThreadPromptBoxUI", () => {
  it("autofocuses the prompt editor in fine pointer desktop viewports", async () => {
    renderNewThreadPrompt(buildThreadModeConfig());

    const textbox = screen.getByRole("textbox");

    await waitFor(() => {
      expect(document.activeElement).toBe(textbox);
    });
  });

  it("omits file mention copy from the projectless thread placeholder", () => {
    renderNewThreadPrompt(buildThreadModeConfig());

    expect(screen.getByRole("textbox").getAttribute("data-placeholder")).toBe(
      "Ask anything.",
    );
  });

  it("hides environment controls for projectless threads", () => {
    renderNewThreadPrompt(buildThreadModeConfig());

    expect(screen.queryByRole("button", { name: "Host" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Environment" })).toBeNull();
  });

  it("uses shared promptbox selector dimensions for model and project controls", () => {
    renderNewThreadPrompt(buildThreadModeConfig());

    const selectorButtons = [
      screen.getByRole("button", { name: "Provider, model and reasoning" }),
      screen.getByRole("button", { name: "Project" }),
    ];

    for (const button of selectorButtons) {
      expect(button.className).toContain("h-8");
      expect(button.className).toContain("px-1");
      expect(button.querySelector("svg")?.getAttribute("class")).toContain(
        "size-3.5",
      );
    }
  });

  it("autofocuses the prompt editor in compact fine pointer viewports", async () => {
    setupCompactViewport();
    renderNewThreadPrompt(buildThreadModeConfig());

    const textbox = screen.getByRole("textbox");

    await waitFor(() => {
      expect(document.activeElement).toBe(textbox);
    });
  });

  it("does not autofocus the prompt editor on coarse pointer devices", async () => {
    setupCoarsePointerViewport();
    renderNewThreadPrompt(buildThreadModeConfig());

    const textbox = screen.getByRole("textbox");
    await waitForAnimationFrame();

    expect(document.activeElement).not.toBe(textbox);
  });
});
