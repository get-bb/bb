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

describe("simple notes slot registrations", () => {
  it("registers the installed-style Simple Notes nav panel surface", () => {
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({
      id: "simple-notes",
      title: "Simple Notes",
      path: "simple-notes",
      chrome: "none",
    });
    expect(app.threadPanelActions).toHaveLength(0);
    expect(app.fileOpeners).toHaveLength(0);
  });
});

describe("simple notes nav panel", () => {
  it("renders recent notes from rpc and deep-links selections", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "ideas.md",
                title: "Ideas",
                preview: "Research better plugin examples",
                modifiedAtMs: Date.now(),
              },
            ]),
        },
      },
    );

    await slot.findByText("Ideas");
    slot.getByText("Research better plugin examples");
    slot.getByText("/Users/me/Notes");
    expect(slot.rpcCalls).toEqual([{ method: "listNotes", input: null }]);

    fireEvent.click(slot.getByText("Ideas"));
    expect(slot.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "simple-notes",
        options: { subPath: "ideas.md" },
      },
    ]);
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
