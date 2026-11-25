// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { GIT_WORKTREE_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";

const app = await loadPluginApp(() => import("./app"));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const REMEMBERED_ON_HOST_A =
  "bb.environment-git-worktree.folders:project-1:host-a";

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

function warmPoolStatus(size: number, readyOnHostA: number): JsonValue {
  return {
    pools: [
      {
        projectId: "project-1",
        projectName: "App",
        size,
        handedOff: 0,
        missed: 0,
        checkouts: [
          {
            hostId: "host-a",
            hostName: "Laptop",
            path: "/code/app",
            size,
            hostSize: null,
            ready: readyOnHostA,
            preparing: 0,
            base: "main",
            lastError: null,
          },
          {
            hostId: "host-b",
            hostName: "Desktop",
            path: "/code/app",
            size,
            hostSize: null,
            ready: 4,
            preparing: 0,
            base: "main",
            lastError: null,
          },
        ],
      },
    ],
  };
}

function render(
  value: JsonValue | null,
  onChange = vi.fn(),
  worktrees: JsonValue[] = WORKTREES,
  warmPool: () => JsonValue = () => ({ pools: [] }),
  folders: string[] = [],
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
      rpc: {
        listExistingWorktrees: () => ({ worktrees }),
        defaultBaseBranch: () => ({ branch: "main" }),
        warmPoolStatus: warmPool,
        listBranchableFolders: () => ({ folders }),
      },
      branchesState: {
        branches: ["main", "release"],
        remoteBranches: ["origin/main"],
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
  it("submits the default branch as soon as it mounts", async () => {
    const { onChange } = render(null);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        status: "ready",
        value: { branch: { kind: "default" }, folders: [] },
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
    expect(
      within(slot.getByRole("dialog")).getByText("Branch from:"),
    ).toBeTruthy();
    expect(slot.getByRole("button", { name: "Default branch" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "release" })).toBeTruthy();
  });

  it("names a picked branch and keeps the worktree new", async () => {
    const { slot, onChange } = render({ branch: { kind: "default" } });
    await openPicker(slot);
    fireEvent.click(slot.getByRole("button", { name: "release" }));
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { branch: { kind: "named", name: "release" }, folders: [] },
    });
  });

  it("allows an explicit remote branch as the worktree base", async () => {
    const { slot, onChange } = render({ branch: { kind: "default" } });
    await openPicker(slot);
    fireEvent.change(slot.getByRole("textbox", { name: "Search branches" }), {
      target: { value: "origin/main" },
    });
    fireEvent.click(slot.getByRole("button", { name: "origin/main" }));
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { branch: { kind: "named", name: "origin/main" }, folders: [] },
    });
  });

  it("moves the Enter target from the search across sections with arrow keys", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { slot, onChange } = render({ branch: { kind: "default" } });
      await openPicker(slot);
      const search = slot.getByRole("textbox", { name: "Search branches" });
      fireEvent.change(search, { target: { value: "release" } });
      const release = slot.getByRole("button", { name: "release" });
      expect(release.hasAttribute("data-highlighted")).toBe(true);
      fireEvent.keyDown(search, { key: "ArrowUp" });
      expect(release.hasAttribute("data-highlighted")).toBe(false);
      expect(
        slot
          .getByRole("button", { name: "Default branch" })
          .hasAttribute("data-highlighted"),
      ).toBe(true);
      expect(scrollIntoView).toHaveBeenCalled();
      fireEvent.keyDown(search, { key: "ArrowDown" });
      fireEvent.keyDown(search, { key: "Enter" });
      expect(onChange).toHaveBeenLastCalledWith({
        status: "ready",
        value: { branch: { kind: "named", name: "release" }, folders: [] },
      });
    } finally {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("branches a project folder with the worktree and keeps it when the base changes", async () => {
    const picked = render(
      { branch: { kind: "default" }, folders: [] },
      vi.fn(),
      WORKTREES,
      () => ({ pools: [] }),
      ["/work/api"],
    );
    await openPicker(picked.slot);
    fireEvent.click(await picked.slot.findByRole("button", { name: /^api/u }));
    expect(picked.onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { branch: { kind: "default" }, folders: ["/work/api"] },
    });
    cleanup();

    const branched = render(
      { branch: { kind: "default" }, folders: ["/work/api"] },
      vi.fn(),
      WORKTREES,
      () => ({ pools: [] }),
      ["/work/api"],
    );
    await waitFor(() => {
      expect(
        branched.slot.getByRole("combobox", { name: "Worktree" }).textContent,
      ).toContain("main +1 folder");
    });
    await openPicker(branched.slot);
    fireEvent.click(branched.slot.getByRole("button", { name: "release" }));
    expect(branched.onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: {
        branch: { kind: "named", name: "release" },
        folders: ["/work/api"],
      },
    });
  });

  it("remembers picked folders for this project and machine and starts the next thread with them", async () => {
    const picked = render(
      { branch: { kind: "named", name: "release" }, folders: [] },
      vi.fn(),
      WORKTREES,
      () => ({ pools: [] }),
      ["/work/api"],
    );
    await openPicker(picked.slot);
    fireEvent.click(await picked.slot.findByRole("button", { name: /^api/u }));
    expect(window.localStorage.getItem(REMEMBERED_ON_HOST_A)).toBe(
      JSON.stringify(["/work/api"]),
    );
    expect(
      window.localStorage.getItem(
        "bb.environment-git-worktree.folders:project-1:host-b",
      ),
    ).toBeNull();
    cleanup();

    const next = render(null, vi.fn(), WORKTREES, () => ({ pools: [] }), [
      "/work/api",
    ]);
    await waitFor(() => {
      expect(next.onChange).toHaveBeenCalledWith({
        status: "ready",
        value: { branch: { kind: "default" }, folders: ["/work/api"] },
      });
    });
  });

  it("forgets a remembered folder that is no longer a branchable project folder", async () => {
    window.localStorage.setItem(
      REMEMBERED_ON_HOST_A,
      JSON.stringify(["/work/api", "/work/gone"]),
    );
    const { onChange } = render(
      { branch: { kind: "default" }, folders: ["/work/api", "/work/gone"] },
      vi.fn(),
      WORKTREES,
      () => ({ pools: [] }),
      ["/work/api"],
    );
    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith({
        status: "ready",
        value: { branch: { kind: "default" }, folders: ["/work/api"] },
      });
    });
    expect(window.localStorage.getItem(REMEMBERED_ON_HOST_A)).toBe(
      JSON.stringify(["/work/api"]),
    );
  });

  it("falls back to the default branch", async () => {
    const { slot, onChange } = render({
      branch: { kind: "named", name: "release" },
    });
    await openPicker(slot);
    fireEvent.click(slot.getByRole("button", { name: "Default branch" }));
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { branch: { kind: "default" }, folders: [] },
    });
  });

  it("checks the chosen section immediately while discovery is pending", async () => {
    const onChange = vi.fn();
    const slot = renderSlot(
      inputsSlot(),
      {
        projectId: "project-1",
        target: { kind: "existing-host", hostId: "host-a" },
        value: { branch: { kind: "default" } },
        onChange,
      },
      {
        rpc: {
          defaultBaseBranch: () => ({ branch: "main" }),
          listExistingWorktrees: () => new Promise(() => {}),
        },
      },
    );
    await openPicker(slot);
    const existing = slot.getByRole("button", { name: "Existing worktree" });
    const fresh = slot.getByRole("button", { name: "New worktree" });
    fireEvent.click(existing);
    expect(existing.querySelector(".opacity-100")).not.toBeNull();
    expect(fresh.querySelector(".opacity-100")).toBeNull();
    expect(
      slot.getByRole("textbox", { name: "Search worktrees" }),
    ).toBeTruthy();
    expect(slot.getByText("Loading worktrees...")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(fresh);
    expect(fresh.querySelector(".opacity-100")).not.toBeNull();
    expect(existing.querySelector(".opacity-100")).toBeNull();
  });

  it.each(["APP-FEATURE", "/code/app-feature", "FEATURE"])(
    "searches existing worktrees by directory, full path, or branch (%s)",
    async (query) => {
      const { slot, onChange } = render({ branch: { kind: "default" } });
      await openPicker(slot);
      fireEvent.click(slot.getByRole("button", { name: "Existing worktree" }));
      await waitFor(() =>
        expect(slot.getByRole("button", { name: /app-feature/u })).toBeTruthy(),
      );
      const search = slot.getByRole("textbox", { name: "Search worktrees" });
      fireEvent.change(search, { target: { value: "absent" } });
      await waitFor(() =>
        expect(slot.getByText("No matching worktrees found.")).toBeTruthy(),
      );
      fireEvent.change(search, { target: { value: query } });
      await waitFor(() =>
        expect(slot.getByRole("button", { name: /app-feature/u })).toBeTruthy(),
      );
      expect(slot.queryByRole("button", { name: /app-hotfix/u })).toBeNull();
      fireEvent.keyDown(search, { key: "Enter" });
      expect(onChange).toHaveBeenLastCalledWith({
        status: "ready",
        value: { kind: "existing", path: "/code/app-feature" },
      });
    },
  );

  it("does not select a prunable worktree through search Enter", async () => {
    const { slot, onChange } = render({ branch: { kind: "default" } });
    await openPicker(slot);
    fireEvent.click(slot.getByRole("button", { name: "Existing worktree" }));
    await waitFor(() =>
      expect(slot.getByRole("button", { name: /app-hotfix/u })).toBeTruthy(),
    );
    const search = slot.getByRole("textbox", { name: "Search worktrees" });
    fireEvent.change(search, { target: { value: "hotfix" } });
    await waitFor(() =>
      expect(slot.queryByRole("button", { name: /app-feature/u })).toBeNull(),
    );
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("picks an existing worktree from the second section", async () => {
    const { slot, onChange } = render({ branch: { kind: "default" } });
    await openPicker(slot);
    fireEvent.click(slot.getByRole("button", { name: "Existing worktree" }));
    await waitFor(() => {
      expect(slot.getByRole("button", { name: /app-feature/u })).toBeTruthy();
    });
    fireEvent.click(slot.getByRole("button", { name: /app-feature/u }));
    expect(onChange).toHaveBeenLastCalledWith({
      status: "ready",
      value: { kind: "existing", path: "/code/app-feature" },
    });
  });

  it("labels the trigger with the base branch or the reused worktree", async () => {
    const fresh = render({ branch: { kind: "default" } });
    await waitFor(() =>
      expect(
        fresh.slot.getByRole("combobox", { name: "Worktree" }).textContent,
      ).toContain("Branch from:main"),
    );
    cleanup();

    const named = render({ branch: { kind: "named", name: "release" } });
    expect(
      named.slot.getByRole("combobox", { name: "Worktree" }).textContent,
    ).toContain("Branch from:release");
    cleanup();

    const reused = render({ kind: "existing", path: "/code/app-feature/" });
    expect(
      reused.slot.getByRole("combobox", { name: "Worktree" }).textContent,
    ).toContain("Reuse:code/app-feature");
  });

  it("drops the trigger prefix in a compact promptbox", async () => {
    const { slot } = render({ branch: { kind: "named", name: "release" } });
    const trigger = slot.getByRole("combobox", { name: "Worktree" });
    const prefix = within(trigger).getByText("Branch from:");
    expect(prefix.dataset.promptboxHideCompact).toBe("");
    expect(
      within(trigger).getByText("release").dataset.promptboxHideCompact,
    ).toBeUndefined();
    cleanup();

    const reused = render({ kind: "existing", path: "/code/app-feature" });
    expect(
      within(reused.slot.getByRole("combobox", { name: "Worktree" })).getByText(
        "Reuse:",
      ).dataset.promptboxHideCompact,
    ).toBe("");
  });

  it("loads existing worktrees only after selecting that section", async () => {
    const list = vi.fn(() => ({ worktrees: [] }));
    const slot = renderSlot(
      inputsSlot(),
      {
        projectId: "project-1",
        target: { kind: "existing-host", hostId: "host-a" },
        value: { branch: { kind: "default" } },
        onChange: vi.fn(),
      },
      {
        rpc: {
          listExistingWorktrees: list,
          defaultBaseBranch: () => ({ branch: "main" }),
        },
      },
    );
    await openPicker(slot);
    expect(list).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: "Existing worktree" }));
    await waitFor(() =>
      expect(slot.getByText("No existing worktrees found.")).toBeTruthy(),
    );
    expect(list).toHaveBeenCalledTimes(1);
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
          defaultBaseBranch: () => ({ branch: "main" }),
          listExistingWorktrees: () =>
            new Promise<{ worktrees: JsonValue[] }>((resolve, reject) => {
              requests.push({ resolve, reject });
            }),
        },
        branchesState: { branches: ["main"] },
      });
      expect(requests).toHaveLength(0);
      await openPicker(slot);
      expect(requests).toHaveLength(0);
      fireEvent.click(slot.getByRole("button", { name: "Existing worktree" }));
      await act(async () => requests[0]!.resolve({ worktrees: WORKTREES }));
      expect(slot.getByRole("button", { name: /app-feature/u })).toBeTruthy();
      fireEvent.click(slot.getByRole("button", { name: "Existing worktree" }));
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
      expect(requests).toHaveLength(2);
      fireEvent.click(slot.getByRole("button", { name: "Existing worktree" }));
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

describe("default branch label scope", () => {
  it.each(["machine", "project"])(
    "ignores a previous %s label without changing default inputs",
    async (change) => {
      const requests: ((value: { branch: string | null }) => void)[] = [];
      const onChange = vi.fn();
      const props = {
        projectId: "project-1",
        target: { kind: "existing-host" as const, hostId: "host-a" },
        value: { branch: { kind: "default" } },
        onChange,
      };
      const list = vi.fn(() => ({ worktrees: WORKTREES }));
      const slot = renderSlot(inputsSlot(), props, {
        rpc: {
          defaultBaseBranch: () =>
            new Promise<{ branch: string | null }>((resolve) =>
              requests.push(resolve),
            ),
          listExistingWorktrees: list,
        },
      });
      expect(slot.getByRole("combobox").textContent).toContain(
        "Branch from:default",
      );
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
      await act(async () => requests[1]!({ branch: "origin/main" }));
      expect(slot.getByRole("combobox").textContent).toContain(
        "Branch from:origin/main",
      );
      await act(async () => requests[0]!({ branch: "old-branch" }));
      expect(slot.getByRole("combobox").textContent).toContain(
        "Branch from:origin/main",
      );
      expect(onChange).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    },
  );
});

describe("warm worktree hint", () => {
  it("counts this machine's warm worktrees on the default branch", async () => {
    const { slot } = render(
      { branch: { kind: "default" } },
      vi.fn(),
      WORKTREES,
      () => warmPoolStatus(2, 1),
    );
    await openPicker(slot);
    const defaultRow = await slot.findByRole("button", {
      name: "Default branch 1 warm",
    });
    expect(defaultRow.getAttribute("title")).toContain("1 warm worktree ready");
  });

  it("opens worktree settings from the picker", async () => {
    const { slot, onChange } = render({ branch: { kind: "default" } });
    await openPicker(slot);
    fireEvent.click(slot.getByRole("button", { name: "Worktree settings" }));
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "experimental_toSettings", target: undefined },
    ]);
    await waitFor(() => {
      expect(slot.queryByText("Work in:")).toBeNull();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows no count while the project's pool is off", async () => {
    const warmPool = vi.fn(() => warmPoolStatus(0, 3));
    const { slot } = render(
      { branch: { kind: "default" } },
      vi.fn(),
      WORKTREES,
      warmPool,
    );
    await openPicker(slot);
    await waitFor(() => expect(warmPool).toHaveBeenCalled());
    await act(async () => undefined);
    expect(slot.getByRole("button", { name: "Default branch" })).toBeTruthy();
  });

  it("updates the count while the picker is open", async () => {
    let ready = 1;
    const { slot } = render(
      { branch: { kind: "default" } },
      vi.fn(),
      WORKTREES,
      () => warmPoolStatus(2, ready),
    );
    await openPicker(slot);
    await slot.findByRole("button", { name: "Default branch 1 warm" });
    ready = 2;
    await slot.emitRealtime("warm-pools-changed", null);
    await slot.findByRole("button", { name: "Default branch 2 warm" });
  });

  it("leaves the default branch unmarked when warm pool status is unavailable", async () => {
    const warmPool = vi.fn(() => {
      throw new Error("plugin server unavailable");
    });
    const { slot } = render(
      { branch: { kind: "default" } },
      vi.fn(),
      WORKTREES,
      warmPool,
    );
    await openPicker(slot);
    await waitFor(() => expect(warmPool).toHaveBeenCalled());
    await act(async () => undefined);
    expect(slot.getByRole("button", { name: "Default branch" })).toBeTruthy();
    expect(
      slot.getByRole("button", { name: "Worktree settings" }),
    ).toBeTruthy();
  });
});
