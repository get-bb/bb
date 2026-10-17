// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { act } from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

import { githubRpcContract } from "./server";

const app = await loadPluginApp(() => import("./app"));

describe("GitHub app navigation", () => {
  it("opens issue details in the URL-backed page instead of a fixed tab", async () => {
    const panel = app.navPanels[0]!;
    expect(panel.fixedTabs).toBeUndefined();

    const slot = renderSlot(
      panel,
      { subPath: "issues" },
      {
        rpc: {
          listItems: () => ({
            items: [
              {
                repo: "get-bb/bb",
                number: 42,
                kind: "issue",
                title: "Route-backed issue",
                state: "OPEN",
                author: "octocat",
                labels: [],
                assignees: [],
                url: "https://github.com/get-bb/bb/issues/42",
                body: "",
                updatedAt: "2026-08-20T00:00:00.000Z",
              },
            ],
          }),
          listLinks: () => ({ links: {} }),
          status: () => ({
            ghOk: true,
            ghState: "ready",
            ghError: null,
            repos: [{ repo: "get-bb/bb", projectId: null }],
            lastSyncedAt: null,
          }),
          viewer: () => ({ login: "octocat" }),
        },
      },
    );

    (await slot.findByText("Route-backed issue")).click();
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "issues/get-bb/bb/42" },
    });
    slot.lifecycle.unmount();
  });

  it("keeps removed pull-request files out of live workspace navigation", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr-1", params: null },
      {
        rpc: {
          pullForThread: () => ({
            pull: {
              repo: "get-bb/bb",
              number: 42,
              environmentId: "env-1",
            },
          }),
          getPull: () => ({
            pull: {
              repo: "get-bb/bb",
              number: 42,
              title: "Navigation fix",
              state: "OPEN",
              author: "octocat",
              body: "",
              url: "https://github.com/get-bb/bb/pull/42",
              createdAt: "2026-08-20T00:00:00.000Z",
              updatedAt: "2026-08-20T00:00:00.000Z",
              baseRefName: "main",
              headRefName: "fix-navigation",
              additions: 1,
              deletions: 1,
              changedFiles: 2,
              labels: [],
              assignees: [],
              reviewDecision: "",
              mergeStateStatus: "CLEAN",
              reviewRequests: [],
              checks: [],
              comments: [],
              reviews: [],
              reviewThreads: [],
              files: [
                {
                  path: "removed.ts",
                  status: "removed",
                  additions: 0,
                  deletions: 1,
                  patch: "@@ -1 +0,0 @@\n-removed",
                },
                {
                  path: "modified.ts",
                  status: "modified",
                  additions: 1,
                  deletions: 0,
                  patch: "@@ -0,0 +1 @@\n+added",
                },
              ],
            },
          }),
          listLinks: () => ({ links: {} }),
        },
      },
    );

    const removedFile = await slot.findByText("removed.ts");
    const modifiedFile = slot.getByText("modified.ts");
    expect(removedFile.closest("a")).toBeNull();
    expect(modifiedFile.closest("a")?.getAttribute("href")).toBe(
      "./modified.ts",
    );

    const diffToggle = removedFile.parentElement?.querySelector("button");
    if (!(diffToggle instanceof HTMLButtonElement)) {
      throw new Error("removed file diff toggle was not rendered");
    }
    expect(diffToggle.getAttribute("aria-label")).toBe(
      "Expand removed.ts diff",
    );
    await act(async () => diffToggle.click());
    const diff = slot.getByTestId("bb-diff");
    expect(diff.getAttribute("data-path")).toBe("removed.ts");
    expect(diffToggle.getAttribute("aria-label")).toBe(
      "Collapse removed.ts diff",
    );
    slot.lifecycle.unmount();
  });
});

const issue = {
  repo: "get-bb/bb",
  number: 42,
  title: "Live detail",
  state: "OPEN",
  author: "octocat",
  body: "Description",
  url: "https://github.com/get-bb/bb/issues/42",
  updatedAt: "2026-08-20T00:00:00.000Z",
  labels: [],
  assignees: [],
  comments: [],
};
const pull = {
  ...issue,
  createdAt: issue.updatedAt,
  baseRefName: "main",
  headRefName: "feature",
  additions: 0,
  deletions: 0,
  changedFiles: 0,
  reviewDecision: "",
  mergeStateStatus: "CLEAN",
  reviewRequests: [],
  checks: [],
  reviews: [],
  reviewThreads: [],
  files: [],
};

function detailView(
  kind: "issue" | "pr",
  firstError = false,
  extraRpc: Record<string, () => unknown> = {},
) {
  const state = { readError: firstError, authError: false, postError: false };
  const view = renderSlot(
    app.navPanels[0]!,
    { subPath: `${kind === "issue" ? "issues" : "pulls"}/get-bb/bb/42` },
    {
      experimental_rpcContract: githubRpcContract,
      rpc: {
        status: () => ({
          ghOk: !state.authError,
          ghState: state.authError ? "unavailable" : "ready",
          ghError: state.authError ? "Connection failed" : null,
          repos: [{ repo: "get-bb/bb", projectId: null }],
          lastSyncedAt: null,
        }),
        listLinks: () => ({ links: {} }),
        getIssue: () => {
          if (state.readError) throw new Error("Detail unavailable");
          return { issue };
        },
        getPull: () => {
          if (state.readError) throw new Error("Detail unavailable");
          return { pull };
        },
        commentIssue: () => {
          if (state.postError) throw new Error("Post failed");
          return { ok: true };
        },
        commentPull: () => {
          if (state.postError) throw new Error("Post failed");
          return { ok: true };
        },
        ...extraRpc,
      },
    },
  );
  return { state, view };
}

it.each(["issue", "pr"] as const)(
  "keeps the %s comment editor through refresh and auth failures, then recovers with Retry",
  async (kind) => {
    const { state, view } = detailView(kind);
    try {
      const editor = await view.findByPlaceholderText("Leave a comment…");
      fireEvent.change(editor, { target: { value: "Keep this draft" } });
      editor.focus();
      state.readError = true;
      await act(async () => {
        await view.experimental_invalidateRpc([`${kind}:get-bb/bb#42`]);
      });
      await view.findByText("Detail unavailable", {}, { timeout: 10_000 });
      expect(view.getByPlaceholderText("Leave a comment…")).toBe(editor);
      expect(document.activeElement).toBe(editor);
      expect((editor as HTMLTextAreaElement).value).toBe("Keep this draft");
      state.readError = false;
      fireEvent.click(view.getByRole("button", { name: "Retry" }));
      await waitFor(() =>
        expect(view.queryByText("Detail unavailable")).toBeNull(),
      );
      state.authError = true;
      await act(async () => {
        await view.experimental_invalidateRpc(["status"]);
      });
      await view.findByText("Connection failed");
      expect(view.getByPlaceholderText("Leave a comment…")).toBe(editor);
      state.authError = false;
      fireEvent.click(
        view.getByRole("button", { name: "Retry GitHub connection" }),
      );
      await waitFor(() =>
        expect(view.queryByText("Connection failed")).toBeNull(),
      );
      expect(view.getByPlaceholderText("Leave a comment…")).toBe(editor);
      expect((editor as HTMLTextAreaElement).value).toBe("Keep this draft");
      state.postError = true;
      fireEvent.click(view.getByRole("button", { name: "Comment" }));
      await waitFor(() =>
        expect(
          view
            .getByRole("button", { name: "Comment" })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      expect((editor as HTMLTextAreaElement).value).toBe("Keep this draft");
    } finally {
      view.lifecycle.unmount();
    }
  },
);

it.each(["issue", "pr"] as const)(
  "offers Retry after the first %s detail read fails",
  async (kind) => {
    const { state, view } = detailView(kind, true);
    try {
      await view.findByText("Detail unavailable", {}, { timeout: 10_000 });
      expect(view.queryByPlaceholderText("Leave a comment…")).toBeNull();
      state.readError = false;
      fireEvent.click(view.getByRole("button", { name: "Retry" }));
      await view.findByPlaceholderText("Leave a comment…");
      expect(view.queryByText("Detail unavailable")).toBeNull();
    } finally {
      view.lifecycle.unmount();
    }
  },
);

it.each(["labels", "assignees", "state"] as const)(
  "predicts issue %s and rolls back a failed write",
  async (field) => {
    const previousScroll = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: () => {},
    });
    let reject!: (error: Error) => void;
    const write = new Promise<never>((_resolve, fail) => {
      reject = fail;
    });
    const { view } = detailView("issue", false, {
      setLabels: () => write,
      setAssignees: () => write,
      setIssueState: () => write,
      repositoryLabels: () => ({ labels: ["bug"] }),
      assignableUsers: () => ({ users: ["mona"] }),
      viewer: () => ({ login: "octocat" }),
    });
    try {
      await view.findByText("Live detail");
      if (field === "state") {
        const control = view.getByRole("combobox");
        fireEvent.click(control);
        fireEvent.click(await view.findByRole("option", { name: "Closed" }));
        await waitFor(() => expect(control.textContent).toContain("Closed"));
        await act(async () => reject(new Error("Write failed")));
        await waitFor(() => expect(control.textContent).toContain("Open"));
      } else {
        fireEvent.pointerDown(
          view.getAllByRole("button", { name: "Edit" })[
            field === "assignees" ? 0 : 1
          ]!,
        );
        const option = await view.findByRole("menuitemcheckbox", {
          name: field === "labels" ? /bug/ : /mona/,
        });
        fireEvent.click(option);
        await waitFor(() =>
          expect(option.getAttribute("aria-checked")).toBe("true"),
        );
        await act(async () => reject(new Error("Write failed")));
        await waitFor(() =>
          expect(option.getAttribute("aria-checked")).toBe("false"),
        );
      }
    } finally {
      view.lifecycle.unmount();
      if (previousScroll)
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollIntoView",
          previousScroll,
        );
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  },
);
