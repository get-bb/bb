// @vitest-environment jsdom
// Frontend tests for the notes plugin's app.tsx, written against the
// official harness (`@bb/plugin-sdk/testing/app`) — no bb host, no bundle.
// The thunk import matters: app.tsx binds the plugin runtime at module load,
// so loadPluginApp installs the test runtime first.
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

interface MountFile {
  path: string;
  name: string;
}

function listNotesResult(files: MountFile[]) {
  return {
    mounts: [{ name: "Work", root: "/work", files, error: null }],
  };
}

describe("notes slot registrations", () => {
  it("registers the nav panel, thread panel action, and markdown file opener", () => {
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({
      id: "notes",
      path: "notes",
      chrome: "none",
    });
    expect(app.threadPanelActions[0]?.id).toBe("note");
    expect(app.fileOpeners[0]).toMatchObject({
      id: "editor",
      extensions: ["md", "mdx", "markdown"],
    });
  });
});

describe("notes nav panel", () => {
  it("renders the mounted tree from rpc and deep-links notes via toPluginPanel", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([{ path: "ideas.md", name: "ideas.md" }]),
        },
      },
    );
    await slot.findByText("ideas.md");
    slot.getByText("Select a note to start writing.");
    expect(slot.rpcCalls).toEqual([{ method: "listNotes", input: null }]);

    fireEvent.click(slot.getByText("ideas.md"));
    expect(slot.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "notes",
        options: { subPath: "0/ideas.md" },
      },
    ]);
  });

  it("refetches the tree when the backend publishes notes-changed", async () => {
    let files: MountFile[] = [{ path: "ideas.md", name: "ideas.md" }];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      { rpc: { listNotes: () => listNotesResult(files) } },
    );
    await slot.findByText("ideas.md");

    files = [...files, { path: "todo.md", name: "todo.md" }];
    await slot.emitRealtime("notes-changed", null);
    await slot.findByText("todo.md");
    expect(slot.rpcCalls.filter((c) => c.method === "listNotes")).toHaveLength(2);
  });

  it("creates a note over rpc and opens it", async () => {
    const saved: unknown[] = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          listNotes: () => listNotesResult([]),
          saveNote: (input) => {
            saved.push(input);
            return { outcome: "written", sha256: "abc" };
          },
        },
      },
    );
    await slot.findByText("No markdown files yet.");
    fireEvent.change(slot.getByPlaceholderText("new-note.md"), {
      target: { value: "plan" },
    });
    fireEvent.click(slot.getByText("+"));
    await slot.findByText("Select a note to start writing.");
    expect(saved).toEqual([
      {
        root: "/work",
        path: "plan.md",
        content: "# plan\n\n",
        expectedSha256: null,
      },
    ]);
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "notes",
      options: { subPath: "0/plan.md" },
    });
  });
});
