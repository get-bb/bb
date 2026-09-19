// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
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
      branchesState: {
        branches: ["main", "release"],
        defaultBaseBranch: "main",
      },
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

  it("labels the trigger with the base branch or the reused worktree", () => {
    const fresh = render({ branch: { kind: "default" } });
    expect(
      fresh.slot.getByRole("combobox", { name: "Worktree" }).textContent,
    ).toContain("Branch from: main");
    cleanup();

    const named = render({ branch: { kind: "named", name: "release" } });
    expect(
      named.slot.getByRole("combobox", { name: "Worktree" }).textContent,
    ).toContain("Branch from: release");
    cleanup();

    const reused = render({ kind: "existing", path: "/code/app-feature" });
    expect(
      reused.slot.getByRole("combobox", { name: "Worktree" }).textContent,
    ).toContain("Reuse: app-feature");
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

describe("worktree discovery scope", () => {
  it.each([
    { change: "machine", failOldRequest: false },
    { change: "project", failOldRequest: false },
    { change: "machine", failOldRequest: true },
    { change: "project", failOldRequest: true },
  ])(
    "hides the previous $change paths and ignores a late response (failure=$failOldRequest)",
    async ({ change, failOldRequest }) => {
      const requests: {
        resolve(value: { worktrees: JsonValue[] }): void;
        reject(error: Error): void;
      }[] = [];
      const props = {
        projectId: "project-1",
        target: { kind: "existing-host" as const, hostId: "host-a" },
        value: { branch: { kind: "default" } },
        onChange: vi.fn(),
      };
      const slot = renderSlot(inputsSlot(), props, {
        rpc: {
          listExistingWorktrees: () =>
            new Promise<{ worktrees: JsonValue[] }>((resolve, reject) => {
              requests.push({ resolve, reject });
            }),
        },
        branchesState: { branches: ["main"] },
      });
      await act(async () => requests[0]!.resolve({ worktrees: WORKTREES }));
      await openPicker(slot);
      fireEvent.click(slot.getByRole("button", { name: "Existing worktree" }));
      expect(slot.getByRole("button", { name: /app-feature/u })).toBeTruthy();
      expect(requests).toHaveLength(2);

      const Component = inputsSlot().component;
      slot.rerender(
        <Component
          {...props}
          projectId={change === "project" ? "project-2" : props.projectId}
          target={{
            kind: "existing-host",
            hostId: change === "machine" ? "host-b" : "host-a",
          }}
        />,
      );
      expect(slot.queryByRole("button", { name: /app-feature/u })).toBeNull();
      expect(
        slot
          .getByRole("button", { name: "Existing worktree" })
          .hasAttribute("disabled"),
      ).toBe(true);
      expect(requests).toHaveLength(3);
      await act(async () =>
        requests[2]!.resolve({
          worktrees: [
            {
              path: "/code/new-target",
              branch: "other",
              locked: false,
              prunable: false,
            },
          ],
        }),
      );
      expect(slot.getByRole("button", { name: /new-target/u })).toBeTruthy();
      await act(async () => {
        if (failOldRequest)
          requests[1]!.reject(new Error("old machine disconnected"));
        else requests[1]!.resolve({ worktrees: WORKTREES });
      });
      expect(slot.queryByRole("button", { name: /app-feature/u })).toBeNull();
      fireEvent.click(slot.getByRole("button", { name: /new-target/u }));
      expect(props.onChange).toHaveBeenLastCalledWith({
        status: "ready",
        value: { kind: "existing", path: "/code/new-target" },
      });
    },
  );
});
