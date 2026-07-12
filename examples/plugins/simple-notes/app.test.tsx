// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

interface NoteSummary {
  path: string;
  title: string;
  preview: string;
  modifiedAtMs: number;
}

function listNotesResult(
  notes: NoteSummary[],
  entries: Array<{ kind: "file" | "directory"; path: string }> = notes.map(
    (note) => ({ kind: "file", path: note.path }),
  ),
) {
  return {
    vaults: [
      {
        id: "personal",
        name: "Personal",
        hostId: null,
        rootPath: "/Users/me/Notes",
      },
    ],
    vault: {
      id: "personal",
      name: "Personal",
      hostId: null,
      rootPath: "/Users/me/Notes",
    },
    hosts: [{ id: "host_local", name: "My Mac", status: "connected" }],
    entries,
    notes,
    truncated: false,
    error: null,
  };
}

const preview = {
  baseUrl: "/api/v1/file-previews/lease",
  expiresAtMs: Date.now() + 60_000,
};

describe("Docs nav panel", () => {
  it("registers the Docs surfaces", () => {
    expect(app.navPanels[0]).toMatchObject({
      id: "docs",
      title: "Docs",
      path: "docs",
    });
    expect(app.messageDirectives).toHaveLength(1);
    expect(app.messageDirectives[0]?.id).toBe("docs");
    expect(app.threadPanelActions[0]).toMatchObject({
      id: "document",
      title: "Docs",
    });
  });

  it("keeps the right sidebar pinned while a note loads", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal/slow.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "slow.md",
                title: "Slow note",
                preview: "",
                modifiedAtMs: 1,
              },
            ]),
          readNote: () => new Promise(() => undefined),
          preparePreview: () => preview,
        },
      },
    );

    await slot.findByText("Loading…");
    const loading = slot.getByRole("status", { name: "Loading document" });
    expect(loading.className).toContain("flex-1");
    expect(loading.querySelectorAll(".animate-pulse")).toHaveLength(15);
    expect(slot.container.querySelector("aside")?.className).toContain(
      "order-2",
    );
  });

  it("keeps folder children together and lets the sidebar collapse and resize", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult(
              [
                {
                  path: "projects/child.md",
                  title: "Child note",
                  preview: "",
                  modifiedAtMs: 2,
                },
                {
                  path: "projects.md",
                  title: "Sibling note",
                  preview: "",
                  modifiedAtMs: 1,
                },
              ],
              [
                { kind: "directory", path: "projects" },
                { kind: "file", path: "projects.md" },
                { kind: "file", path: "projects/child.md" },
              ],
            ),
        },
      },
    );

    await slot.findByText("Child note");
    const aside = slot.container.querySelector("aside");
    expect(aside?.className).toContain("order-2");
    expect(aside?.className).toContain("border-l");
    const rows = [...(aside?.querySelectorAll("button") ?? [])].map((node) =>
      node.textContent?.trim(),
    );
    expect(rows.indexOf("Child note")).toBe(rows.indexOf("projects") + 1);
    expect(rows.indexOf("Sibling note")).toBeGreaterThan(
      rows.indexOf("Child note"),
    );

    fireEvent.click(slot.getByLabelText("Collapse notes sidebar"));
    expect(slot.getByLabelText("Expand notes sidebar")).toBeTruthy();
    expect(slot.container.querySelector("aside")?.style.width).toBe("40px");

    fireEvent.click(slot.getByLabelText("Expand notes sidebar"));
    const resizeHandle = slot.getByRole("separator", {
      name: "Resize notes sidebar",
    });
    fireEvent.pointerDown(resizeHandle, { clientX: 288 });
    fireEvent.pointerMove(window, { clientX: 176 });
    expect(slot.container.querySelector("aside")?.style.width).toBe("400px");
    fireEvent.pointerUp(window);
  });

  it("only shows host status when the selected vault is unavailable", async () => {
    const available = listNotesResult([]);
    const unavailable = {
      ...available,
      vault: { ...available.vault, hostId: "host_remote" },
      vaults: available.vaults.map((vault) => ({
        ...vault,
        hostId: "host_remote",
      })),
      hosts: [
        { id: "host_remote", name: "Remote Mac", status: "disconnected" },
      ],
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal" },
      { rpc: { listNotes: () => unavailable } },
    );

    await slot.findByText("Host unavailable");
    expect(slot.queryByText("Remote Mac")).toBeNull();
  });

  it("keeps task checkboxes aligned with the first line of their text", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal/tasks.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "tasks.md",
                title: "Tasks",
                preview: "One task",
                modifiedAtMs: 1,
              },
            ]),
          readNote: () => ({ content: "- [ ] One task", sha256: "sha" }),
          preparePreview: () => preview,
          renameToTitle: () => ({ path: "tasks.md" }),
        },
      },
    );

    await slot.findByText("One task");
    expect(slot.queryByRole("button", { name: "Add image" })).toBeNull();
    expect(slot.container.querySelector('input[type="file"]')).toBeNull();
    const styles = document.head.querySelector(
      "style[data-bb-simple-notes-styles]",
    );
    expect(styles?.textContent).toContain("align-items: flex-start");
    expect(styles?.textContent).toContain("height: 1.7em");
    expect(styles?.textContent).toContain("cursor: pointer; margin: 0");
  });

  it("renders nested folders, images, and sandboxed HTML directives", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal/projects/article.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult(
              [
                {
                  path: "projects/article.md",
                  title: "Article",
                  preview: "A typeset note",
                  modifiedAtMs: Date.now(),
                },
              ],
              [
                { kind: "directory", path: "projects" },
                { kind: "file", path: "projects/article.md" },
                { kind: "file", path: "projects/report.html" },
              ],
            ),
          readNote: () => ({
            content:
              '# Article\n\n![Sketch](./_attachments/sketch.png)\n\n::html{src="./report.html" height="240"}',
            sha256: "sha-1",
          }),
          preparePreview: () => preview,
          renameToTitle: () => ({ path: "projects/article.md" }),
        },
      },
    );

    await slot.findByText("Article");
    expect(slot.getByText("projects")).toBeTruthy();
    await waitFor(() => {
      const image = slot.container.querySelector("img");
      expect(image?.getAttribute("src")).toBe(
        "/api/v1/file-previews/lease/projects/_attachments/sketch.png",
      );
      const iframe = slot.container.querySelector("iframe");
      expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
      expect(iframe?.getAttribute("src")).toBe(
        "/api/v1/file-previews/lease/projects/report.html",
      );
    });
  });

  it("creates a note inside the currently selected folder", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal/projects/existing.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult(
              [
                {
                  path: "projects/existing.md",
                  title: "Existing",
                  preview: "",
                  modifiedAtMs: 1,
                },
              ],
              [
                { kind: "directory", path: "projects" },
                { kind: "file", path: "projects/existing.md" },
              ],
            ),
          readNote: () => ({ content: "# Existing", sha256: "sha" }),
          preparePreview: () => preview,
          createNote: () => ({ path: "projects/Untitled.md" }),
          renameToTitle: () => ({ path: "projects/existing.md" }),
        },
      },
    );

    await slot.findByText("Existing");
    fireEvent.click(slot.getByLabelText("New note"));

    await waitFor(() => {
      expect(slot.rpcCalls).toContainEqual({
        method: "createNote",
        input: { vaultId: "personal", parent: "projects", name: "Untitled" },
      });
    });
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "docs",
      options: { subPath: "personal/projects/Untitled.md", replace: false },
    });
  });

  it("opens Docs directive cards in the thread panel or full editor", () => {
    const openThreadPanel = vi.fn(() => true);
    const slot = renderSlot(app.messageDirectives[0]!, {
      attributes: {
        vault: "personal",
        path: "plans/release.md",
        title: "Release plan",
      },
      source:
        '::docs{vault="personal" path="plans/release.md" title="Release plan"}',
      message: {
        id: "msg_1",
        threadId: "thr_1",
        turnId: "turn_1",
        projectId: null,
      },
      openWorkspaceFile: null,
      openThreadPanel,
    });

    fireEvent.click(slot.getByText("Release plan"));
    expect(slot.queryByText("personal · plans/release.md")).toBeNull();
    expect(openThreadPanel).toHaveBeenCalledWith({
      actionId: "document",
      title: "Release plan",
      params: {
        vaultId: "personal",
        path: "plans/release.md",
        title: "Release plan",
      },
    });

    fireEvent.click(slot.getByRole("button", { name: "Open in Docs" }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "docs",
      options: { subPath: "personal/plans/release.md" },
    });
  });

  it("renders a linked Markdown document in the Docs thread panel", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      {
        threadId: "thr_1",
        params: {
          vaultId: "personal",
          path: "plans/release.md",
          title: "Release plan",
        },
      },
      {
        rpc: {
          readNote: () => ({
            content: "# Release plan\n\nShip it.",
            sha256: "sha",
          }),
          preparePreview: () => preview,
        },
      },
    );

    await slot.findByText("Ship it.");
    expect(slot.getAllByText("Release plan")).toHaveLength(2);
    expect(slot.queryByText("plans/release.md")).toBeNull();
    expect(slot.getByRole("textbox").getAttribute("contenteditable")).toBe(
      "true",
    );
    fireEvent.click(slot.getByRole("button", { name: "Open in Docs" }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "docs",
      options: { subPath: "personal/plans/release.md" },
    });
  });

  it("opens a full HTML page through the same preview lease", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal/dashboards/metrics.html" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult(
              [],
              [
                { kind: "directory", path: "dashboards" },
                { kind: "file", path: "dashboards/metrics.html" },
              ],
            ),
          preparePreview: () => preview,
        },
      },
    );

    await waitFor(() => {
      const iframe = slot.container.querySelector("iframe");
      expect(iframe?.getAttribute("src")).toBe(
        "/api/v1/file-previews/lease/dashboards/metrics.html",
      );
      expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    });
    expect(slot.queryByRole("button", { name: "View source" })).toBeNull();
  });

  it("filters the vault tree by note title", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "roadmap.md",
                title: "Roadmap",
                preview: "Quarterly priorities",
                modifiedAtMs: 2,
              },
              {
                path: "meeting.md",
                title: "Meeting",
                preview: "Launch checklist",
                modifiedAtMs: 1,
              },
            ]),
        },
      },
    );

    await slot.findByText("Roadmap");
    expect(slot.queryByText("Primary host")).toBeNull();
    const vault = slot.getByRole("combobox", { name: "Vault" });
    expect(vault.closest("aside")).toBeTruthy();
    expect(vault.className).toContain("border-transparent");
    expect(slot.queryByPlaceholderText("Search this vault")).toBeNull();
    fireEvent.click(slot.getByLabelText("Search notes"));
    fireEvent.change(slot.getByPlaceholderText("Search this vault"), {
      target: { value: "meeting" },
    });
    expect(slot.queryByText("Roadmap")).toBeNull();
    slot.getByText("Meeting");
    fireEvent.keyDown(slot.getByPlaceholderText("Search this vault"), {
      key: "Escape",
    });
    expect(slot.queryByPlaceholderText("Search this vault")).toBeNull();
    slot.getByText("Roadmap");
  });
});
