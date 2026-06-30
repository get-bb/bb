// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Host, ProjectSource } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentPickerUI } from "./EnvironmentPicker";

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

describe("EnvironmentPickerUI", () => {
  it("disables new worktree without disabling local work for non-git sources", () => {
    render(
      <EnvironmentPickerUI
        value={`host:${host.id}:local`}
        onChange={vi.fn()}
        sources={sources}
        host={host}
        isLocal
        worktreeDisabledReason="Project source is not a git repository"
        modal={false}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Environment" }), {
      button: 0,
    });

    const localItem = screen.getByRole("menuitem", { name: /Work locally/u });
    const worktreeItem = screen.getByRole("menuitem", {
      name: /New worktree/u,
    });

    expect(localItem.getAttribute("aria-disabled")).toBeNull();
    expect(worktreeItem.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen.getByText("Project source is not a git repository"),
    ).toBeTruthy();
  });
});
