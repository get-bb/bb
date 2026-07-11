// @vitest-environment jsdom
// Frontend tests for the Simple Notes plugin's app.tsx, written against the
// official harness (`@bb/plugin-sdk/testing/app`) — no bb host, no bundle.
// The thunk import matters: app.tsx binds the plugin runtime at module load,
// so loadPluginApp installs the test runtime first.
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

interface NoteSummary {
  path: string;
  title: string;
  preview: string;
  modifiedAtMs: number;
}

function listNotesResult(notes: NoteSummary[]) {
  return {
    root: "/Users/me/Notes",
    notes,
    error: null,
  };
}

describe("simple notes nav panel", () => {
  it("uses the Shadcn article typeset rhythm for note content", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "article.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "article.md",
                title: "Article",
                preview: "A typeset note",
                modifiedAtMs: Date.now(),
              },
            ]),
          readNote: () => ({
            content: "# Article\n\nA typeset note.",
            sha256: "sha-1",
          }),
          renameToTitle: () => ({ path: "article.md" }),
        },
      },
    );

    await slot.findByText("A typeset note.");
    const styles = document.head.querySelector(
      "style[data-bb-simple-notes-styles]",
    )?.textContent;

    expect(styles).toContain("max-width: 48em");
    expect(styles).toContain("font-size: 15px");
    expect(styles).toContain("line-height: 1.75");
    expect(styles).toContain("margin: 1.25em 0 0");
    expect(styles).toContain("font-size: 1.75em");
  });

  it("aligns task checkboxes with the first label line without flattening later content spacing", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "tasks.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "tasks.md",
                title: "Tasks",
                preview: "A task list",
                modifiedAtMs: Date.now(),
              },
            ]),
          readNote: () => ({
            content: "# Tasks\n\n- [ ] First task",
            sha256: "sha-tasks",
          }),
          renameToTitle: () => ({ path: "tasks.md" }),
        },
      },
    );

    await slot.findByText("First task");
    const styles = document.head.querySelector(
      "style[data-bb-simple-notes-styles]",
    )?.textContent;

    expect(styles).toContain(
      'ul[data-type="taskList"] li > div > p:first-child { margin-top: 0; }',
    );
    expect(styles).toContain(
      'ul[data-type="taskList"] li > div > p { line-height: 1.75; }',
    );
    expect(styles).toContain(
      ".tiptap ul, .bb-simple-notes-editor .tiptap ol { margin: 1.25em 0 0;",
    );
  });

  it("creates a note over rpc and opens it", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          listNotes: () => listNotesResult([]),
          createNote: () => ({ path: "Untitled.md" }),
        },
      },
    );

    await slot.findByText(
      "No notes yet. Use the compose button to create your first note.",
    );
    fireEvent.click(slot.getByText("New note"));

    await waitFor(() => {
      expect(slot.rpcCalls).toContainEqual({
        method: "createNote",
        input: { name: "Untitled" },
      });
    });
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "simple-notes",
      options: { subPath: "Untitled.md" },
    });
  });

  it("filters notes by title and preview", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "roadmap.md",
                title: "Roadmap",
                preview: "Quarterly priorities",
                modifiedAtMs: Date.now(),
              },
              {
                path: "meeting.md",
                title: "Meeting",
                preview: "Launch checklist",
                modifiedAtMs: Date.now() - 60_000,
              },
            ]),
        },
      },
    );

    await slot.findByText("Roadmap");
    fireEvent.change(slot.getByPlaceholderText("Search notes"), {
      target: { value: "launch" },
    });

    expect(slot.queryByText("Roadmap")).toBeNull();
    slot.getByText("Meeting");
  });
});
