// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Host, ProjectSource } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadEnvSlot } from "./NewThreadPromptBox";

const host: Host = {
  id: "host_test",
  name: "Local host",
  type: "persistent",
  status: "connected",
  lastSeenAt: null,
  createdAt: 0,
  updatedAt: 0,
};

const sources: readonly ProjectSource[] = [
  {
    id: "src_test",
    projectId: "proj_test",
    type: "local_path",
    hostId: host.id,
    path: "/tmp/project",
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
  },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadEnvSlot", () => {
  it("forwards worktree disabled reasons to the environment picker", () => {
    render(
      <ThreadEnvSlot
        environment={{
          value: `host:${host.id}:local`,
          onChange: vi.fn(),
          sources,
          host,
          isLocal: true,
          worktreeDisabledReason: "Project source is not a git repository",
        }}
        branch={{
          value: null,
          currentBranch: null,
          isNew: false,
          options: [],
          onChange: vi.fn(),
        }}
        worktree={{
          options: [],
          value: null,
          onChange: vi.fn(),
        }}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    const worktreeItem = screen.getByRole("menuitem", {
      name: /New worktree/u,
    });

    expect(worktreeItem.getAttribute("aria-disabled")).toBe("true");
    expect(worktreeItem.getAttribute("data-disabled")).toBe("");
  });

  it("hides the branch picker when branch controls are not applicable", () => {
    render(
      <ThreadEnvSlot
        environment={{
          value: `host:${host.id}:local`,
          onChange: vi.fn(),
          sources,
          host,
          isLocal: true,
        }}
        branch={{
          value: null,
          currentBranch: null,
          isNew: false,
          hidden: true,
          options: [],
          triggerLabel: "Unknown checkout",
          onChange: vi.fn(),
        }}
        worktree={{
          options: [],
          value: null,
          onChange: vi.fn(),
        }}
      />,
    );

    expect(screen.queryByText("Unknown checkout")).toBeNull();
  });
});
