// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";

const app = await loadPluginApp(() => import("./app"));
const { selectedBranchName, selectedExistingPath, worktreeDirectoryName } =
  await import("./app");

afterEach(() => {
  cleanup();
});

function inputsSlot() {
  const registration = app.environmentProviderInputs.find(
    (candidate) =>
      candidate.environmentProviderId === GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID,
  );
  if (registration === undefined) {
    throw new Error("the worktree inputs control was not registered");
  }
  return registration;
}

const WORKTREES: JsonValue[] = [
  {
    path: "/code/app-feature",
    branch: "feature",
    locked: false,
    prunable: false,
  },
  { path: "/code/app-hotfix", branch: "hotfix", locked: false, prunable: true },
];

function render(
  value: JsonValue | null,
  onChange = vi.fn(),
  worktrees: JsonValue[] = WORKTREES,
) {
  const slot = renderSlot(
    inputsSlot(),
    {
      projectId: "project-1",
      target: { kind: "existing-host", hostId: "host-a" },
      value,
      onChange,
    },
    {
      rpc: { listExistingWorktrees: () => ({ worktrees }) },
      branchesState: { branches: ["main", "release"] },
    },
  );
  return { slot, onChange };
}

async function openPicker(slot: ReturnType<typeof render>["slot"]) {
  fireEvent.click(slot.getByRole("combobox", { name: "Worktree" }));
  await waitFor(() => {
    expect(slot.getByText("Work in:")).toBeTruthy();
  });
}

describe("worktree inputs control", () => {
  it("registers for the worktree provider only", () => {
    expect(
      app.environmentProviderInputs.map((r) => r.environmentProviderId),
    ).toEqual([GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID]);
  });

  it("submits the default branch as soon as it mounts", async () => {
    const { onChange } = render(null);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        status: "ready",
        value: { branch: { kind: "default" } },
      });
    });
  });

  it("offers both sections from one trigger", async () => {
    const { slot } = render({ branch: { kind: "default" } });
    expect(slot.queryAllByRole("combobox")).toHaveLength(1);
    await openPicker(slot);
    expect(slot.getByRole("button", { name: "New worktree" })).toBeTruthy();
    expect(
      slot.getByRole("button", { name: "Existing worktree" }),
    ).toBeTruthy();
    expect(slot.getByText("Branch from:")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Default branch" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "release" })).toBeTruthy();
  });

  it("names a picked branch and keeps the worktree new", async () => {
    const { slot, onChange } = render({ branch: { kind: "default" } });
    await openPicker(slot);
    fireEvent.click(slot.getByRole("button", { name: "release" }));
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { branch: { kind: "named", name: "release" } },
    });
  });

  it("falls back to the default branch", async () => {
    const { slot, onChange } = render({
      branch: { kind: "named", name: "release" },
    });
    await openPicker(slot);
    fireEvent.click(slot.getByRole("button", { name: "Default branch" }));
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { branch: { kind: "default" } },
    });
  });

  it("picks an existing worktree from the second section", async () => {
    const { slot, onChange } = render({ branch: { kind: "default" } });
    await openPicker(slot);
    fireEvent.click(slot.getByRole("button", { name: "Existing worktree" }));
    await waitFor(() => {
      expect(slot.getByText("Existing worktree:")).toBeTruthy();
    });
    fireEvent.click(slot.getByRole("button", { name: /app-feature/u }));
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { kind: "existing", path: "/code/app-feature" },
    });
  });

  it("names the chosen worktree on the trigger", () => {
    const { slot } = render({ kind: "existing", path: "/code/app-feature" });
    expect(
      slot.getByRole("combobox", { name: "Worktree" }).textContent,
    ).toContain("app-feature");
  });

  it("refuses to offer the existing section with nothing to adopt", async () => {
    const { slot } = render({ branch: { kind: "default" } }, vi.fn(), []);
    await openPicker(slot);
    expect(
      slot
        .getByRole("button", { name: "Existing worktree" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("reads the current selection out of persisted inputs", () => {
    expect(
      selectedBranchName({ branch: { kind: "named", name: "main" } }),
    ).toBe("main");
    expect(selectedBranchName({ branch: { kind: "default" } })).toBeNull();
    expect(selectedBranchName(null)).toBeNull();
    expect(selectedExistingPath({ kind: "existing", path: "/x" })).toBe("/x");
    expect(selectedExistingPath({ branch: { kind: "default" } })).toBeNull();
    expect(worktreeDirectoryName("/code/app-feature/")).toBe("app-feature");
  });
});
