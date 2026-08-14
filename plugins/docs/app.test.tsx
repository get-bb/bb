// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

// jsdom has no matchMedia; @bb/shared-ui's responsive overlays query it.
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
  entryOrder: string[] = [],
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
    entryOrder,
    notes,
    truncated: false,
    error: null,
  };
}

const preview = {
  baseUrl: "/api/v1/file-previews/lease",
  expiresAtMs: Date.now() + 60_000,
};

function makeDataTransfer(path: string) {
  let storedPath = path;
  return {
    effectAllowed: "none",
    dropEffect: "none",
    types: ["text/plain"],
    setData: vi.fn((_type: string, value: string) => {
      storedPath = value;
    }),
    getData: vi.fn(() => storedPath),
  };
}

describe("Docs nav panel", () => {
  it("registers the Docs surfaces", () => {
    expect(app.navPanels[0]).toMatchObject({
      id: "docs",
      title: "Docs",
      path: "docs",
      headerContent: expect.any(Function),
    });
    expect(app.messageDirectives).toHaveLength(1);
    expect(app.messageDirectives[0]?.id).toBe("docs");
    expect(app.threadPanelActions[0]).toMatchObject({
      id: "document",
      title: "Document",
    });
    expect(app.fileOpeners[0]).toMatchObject({
      id: "docs",
      title: "Markdown",
      extensions: ["md", "mdx", "markdown"],
    });
  });

  it("keeps the sidebar toggle in the page header above sidebar actions", async () => {
    const panel = app.navPanels[0]!;
    const slot = renderSlot(
      panel,
      { subPath: "personal" },
      { rpc: { listNotes: () => listNotesResult([]) } },
    );
    await slot.findByText("Select a note or HTML page.");

    const HeaderContent = panel.headerContent!;
    const header = render(<HeaderContent subPath="personal" />);
    const headerSegment = header.getByTestId("notes-sidebar-header");
    expect(headerSegment.classList.contains("w-8")).toBe(true);
    // The sidebar is the plugin's own panel: it stays below the host header,
    // so no plugin chrome may paint over the header's seam.
    expect(header.queryByTestId("notes-sidebar-header-background")).toBeNull();
    const toolbar = slot.getByRole("toolbar", {
      name: "Notes sidebar actions",
    });
    expect(slot.getByRole("navigation", { name: "Notes" })).toBeTruthy();
    expect(
      slot.container.querySelector("aside")?.classList.contains("bg-muted/20"),
    ).toBe(true);
    expect(
      within(toolbar).getByRole("button", { name: "Search notes" }),
    ).toBeTruthy();
    expect(
      within(toolbar).getByRole("button", { name: "New note" }),
    ).toBeTruthy();
    expect(
      within(toolbar).getByRole("button", { name: "New folder" }),
    ).toBeTruthy();
    expect(
      within(toolbar).queryByRole("button", {
        name: "Collapse notes sidebar",
      }),
    ).toBeNull();
    fireEvent.click(
      header.getByRole("button", { name: "Collapse notes sidebar" }),
    );
    expect(slot.container.querySelector("aside")?.style.width).toBe("0px");
    fireEvent.click(
      header.getByRole("button", { name: "Expand notes sidebar" }),
    );
    expect(slot.container.querySelector("aside")?.style.width).toBe("288px");

    header.unmount();
    const fallbackToggle = await slot.findByRole("button", {
      name: "Collapse notes sidebar",
    });
    fireEvent.click(slot.getByRole("button", { name: "Search notes" }));
    await waitFor(() => {
      expect(slot.getByRole("button", { name: "Close search" })).toBeTruthy();
    });
    expect(fallbackToggle.parentElement?.classList.contains("gap-1")).toBe(
      true,
    );
  });

  it("keeps the header toggle inside its own box in a split pane", () => {
    const HeaderContent = app.navPanels[0]!.headerContent!;
    const header = render(
      <div data-split-pane-id="pane-docs">
        <HeaderContent subPath="personal" />
      </div>,
    );

    const headerSegment = header.getByTestId("notes-sidebar-header");
    // The toggle must not reach into the host's own split-pane controls.
    expect(headerSegment.classList.contains("-mr-4")).toBe(false);
    expect(headerSegment.classList.contains("w-8")).toBe(true);
    expect(header.queryByTestId("notes-sidebar-header-background")).toBeNull();
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
    let nextFrameId = 1;
    const frames = new Map<number, FrameRequestCallback>();
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    const cancelAnimationFrame = vi.fn((frameId: number) => {
      frames.delete(frameId);
    });
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
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
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    resizeHandle.setPointerCapture = setPointerCapture;
    resizeHandle.hasPointerCapture = () => true;
    resizeHandle.releasePointerCapture = releasePointerCapture;
    fireEvent.pointerDown(resizeHandle, { clientX: 288, pointerId: 7 });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    fireEvent.pointerMove(resizeHandle, { clientX: 176, pointerId: 7 });
    fireEvent.pointerMove(resizeHandle, { clientX: 156, pointerId: 7 });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(slot.container.querySelector("aside")?.style.width).toBe("288px");
    const firstFrame = frames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    expect(firstFrame).toBeTruthy();
    act(() => firstFrame?.[1](0));
    frames.delete(firstFrame?.[0] ?? -1);
    expect(slot.container.querySelector("aside")?.style.width).toBe("420px");
    fireEvent.pointerMove(resizeHandle, { clientX: 146, pointerId: 7 });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(resizeHandle, { pointerId: 7 });
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(slot.container.querySelector("aside")?.style.width).toBe("430px");
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it("isolates sidebar width and collapse state between panes on one vault", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 17),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const panel = app.navPanels[0]!;
    const PanelContent = panel.component;
    const rpc = { listNotes: () => listNotesResult([]) };
    const first = renderSlot(panel, { subPath: "personal" }, { rpc });
    const second = renderSlot(panel, { subPath: "personal" }, { rpc });
    first.rerender(
      <div data-split-pane-id="pane-one">
        <PanelContent subPath="personal" />
      </div>,
    );
    second.rerender(
      <div data-split-pane-id="pane-two">
        <PanelContent subPath="personal" />
      </div>,
    );
    await within(first.container).findByText("Select a note or HTML page.");
    await within(second.container).findByText("Select a note or HTML page.");

    const HeaderContent = panel.headerContent!;
    const firstHeader = render(
      <div data-split-pane-id="pane-one">
        <HeaderContent subPath="personal" />
      </div>,
    );
    const secondHeader = render(
      <div data-split-pane-id="pane-two">
        <HeaderContent subPath="personal" />
      </div>,
    );
    const firstAside = first.container.querySelector("aside");
    const secondAside = second.container.querySelector("aside");
    expect(firstAside?.style.width).toBe("288px");
    expect(secondAside?.style.width).toBe("288px");

    const resizeHandle = within(first.container).getByRole("separator", {
      name: "Resize notes sidebar",
    });
    resizeHandle.setPointerCapture = vi.fn();
    resizeHandle.hasPointerCapture = () => true;
    resizeHandle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(resizeHandle, { clientX: 288, pointerId: 11 });
    fireEvent.pointerMove(resizeHandle, { clientX: 176, pointerId: 11 });
    fireEvent.pointerUp(resizeHandle, { pointerId: 11 });

    expect(firstAside?.style.width).toBe("400px");
    expect(secondAside?.style.width).toBe("288px");

    fireEvent.click(
      within(firstHeader.container).getByRole("button", {
        name: "Collapse notes sidebar",
      }),
    );
    expect(firstAside?.style.width).toBe("0px");
    expect(secondAside?.style.width).toBe("288px");
    expect(
      within(secondHeader.container).getByRole("button", {
        name: "Collapse notes sidebar",
      }),
    ).toBeTruthy();

    firstHeader.unmount();
    first.unmount();
    const reopened = renderSlot(panel, { subPath: "personal" }, { rpc });
    reopened.rerender(
      <div data-split-pane-id="pane-one">
        <PanelContent subPath="personal" />
      </div>,
    );
    await within(reopened.container).findByText("Select a note or HTML page.");
    const reopenedHeader = render(
      <div data-split-pane-id="pane-one">
        <HeaderContent subPath="personal" />
      </div>,
    );
    expect(reopened.container.querySelector("aside")?.style.width).toBe(
      "288px",
    );
    expect(
      within(reopenedHeader.container).getByRole("button", {
        name: "Collapse notes sidebar",
      }),
    ).toBeTruthy();
  });

  it("defaults the sidebar to collapsed in a narrow pane but allows expanding", async () => {
    class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const clientWidth = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "clientWidth",
    );
    Object.defineProperty(Element.prototype, "clientWidth", {
      configurable: true,
      get: () => 400,
    });
    try {
      const slot = renderSlot(
        app.navPanels[0]!,
        { subPath: "personal" },
        {
          rpc: {
            listNotes: () =>
              listNotesResult([
                {
                  path: "note.md",
                  title: "Note",
                  preview: "",
                  modifiedAtMs: 1,
                },
              ]),
          },
        },
      );

      const expand = await slot.findByLabelText("Expand notes sidebar");
      expect(slot.container.querySelector("aside")?.style.width).toBe("40px");

      fireEvent.click(expand);
      expect(slot.getByLabelText("Collapse notes sidebar")).toBeTruthy();
      expect(slot.container.querySelector("aside")?.style.width).toBe("288px");
    } finally {
      if (clientWidth) {
        Object.defineProperty(Element.prototype, "clientWidth", clientWidth);
      }
      vi.unstubAllGlobals();
    }
  });

  it("passes note paths with spaces to host navigation without pre-encoding", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "Tasks follow up apis.md",
                title: "Tasks follow up apis",
                preview: "",
                modifiedAtMs: 1,
              },
            ]),
        },
      },
    );

    fireEvent.click(await slot.findByText("Tasks follow up apis"));

    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "docs",
      options: {
        subPath: "personal/Tasks follow up apis.md",
        replace: false,
      },
    });
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
    const existingStyles = document.head.querySelector(
      "style[data-bb-simple-notes-styles]",
    );
    if (existingStyles) existingStyles.textContent = "stale editor styles";
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
          readNote: () => ({
            content: "- [x] One task\n  - [ ] Nested task",
            sha256: "sha",
          }),
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
    expect(styles?.textContent).not.toBe("stale editor styles");
    expect(styles?.textContent).toContain("align-items: flex-start");
    expect(styles?.textContent).toContain("height: 1.7em");
    expect(styles?.textContent).toContain("cursor: pointer; margin: 0");
    expect(styles?.textContent).toContain(
      'ul[data-type="taskList"] ul[data-type="taskList"] { margin-top: 0; }',
    );
    expect(styles?.textContent).toContain(
      'ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; margin-top: 0.5em;',
    );
  });

  it("renders and autosaves editable Markdown tables", async () => {
    const saveNote = vi.fn((_input: unknown) => ({
      outcome: "written",
      sha256: "next-sha",
    }));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal/status.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "status.md",
                title: "Status",
                preview: "Docs Ready",
                modifiedAtMs: 1,
              },
            ]),
          readNote: () => ({
            content:
              "# Status\n\n| Project | State |\n| --- | --- |\n| Docs | Ready |",
            sha256: "sha",
          }),
          preparePreview: () => preview,
          renameToTitle: () => ({ path: "status.md" }),
          saveNote,
        },
      },
    );

    await slot.findByText("Ready");
    const table = slot.container.querySelector("table");
    expect(table).toBeTruthy();
    expect(table?.querySelector("th")?.textContent).toBe("Project");
    expect(table?.querySelector("td")?.textContent).toBe("Docs");
    expect(table?.closest(".tableWrapper")).toBeTruthy();
    expect(table?.closest('[contenteditable="true"]')).toBeTruthy();

    const styles = document.head.querySelector(
      "style[data-bb-simple-notes-styles]",
    );
    expect(styles?.textContent).toContain("border-collapse: collapse");
    expect(styles?.textContent).toContain("column-resize-handle");

    const firstBodyCell = table?.querySelector("td p");
    expect(firstBodyCell).toBeTruthy();
    firstBodyCell!.textContent = "Plans";
    fireEvent.input(firstBodyCell!);
    await waitFor(() => expect(saveNote).toHaveBeenCalled(), {
      timeout: 2_000,
    });
    expect(saveNote.mock.calls.at(-1)?.[0]).toMatchObject({
      content: expect.stringContaining("| Plans | Ready |"),
    });
  });

  it("hides and preserves YAML frontmatter when editing a document", async () => {
    const frontmatter = [
      "---\r\n",
      "title: Wiki page\r\n",
      "type: knowledge\r\n",
      "---\r\n",
    ].join("");
    const saveNote = vi.fn((_input: unknown) => ({
      outcome: "written",
      sha256: "next-sha",
    }));
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal/wiki-page.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "wiki-page.md",
                title: "Wiki page",
                preview: "Original body.",
                modifiedAtMs: 1,
              },
            ]),
          readNote: () => ({
            content: `${frontmatter}\r\n# Wiki page\r\n\r\nOriginal body.`,
            sha256: "sha",
          }),
          preparePreview: () => preview,
          renameToTitle: () => ({ path: "wiki-page.md" }),
          saveNote,
        },
      },
    );

    const body = await slot.findByText("Original body.");
    const editor = slot.container.querySelector(".tiptap");
    expect(editor?.textContent).not.toContain("type: knowledge");
    expect(editor?.querySelector("hr")).toBeNull();

    body.textContent = "Edited body.";
    fireEvent.input(body);
    await waitFor(() => expect(saveNote).toHaveBeenCalled(), {
      timeout: 2_000,
    });
    // The blank line separating frontmatter from the body survives the first
    // save: without it every real-world document picks up a spurious diff line.
    expect(saveNote.mock.calls.at(-1)?.[0]).toMatchObject({
      content: expect.stringMatching(
        /^---\r\ntitle: Wiki page\r\ntype: knowledge\r\n---\r\n\r\n# Wiki page\n\nEdited body\./,
      ),
    });
  });

  it("keeps a leading thematic break visible in the editor", async () => {
    const content = "---\n\nSome intro text.\n\n---\n\nMore text.\n";
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal/break.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "break.md",
                title: "Break doc",
                preview: "Some intro text. More text.",
                modifiedAtMs: 1,
              },
            ]),
          readNote: () => ({ content, sha256: "sha" }),
          preparePreview: () => preview,
          renameToTitle: () => ({ path: "break.md" }),
          saveNote: () => ({ outcome: "written", sha256: "next-sha" }),
        },
      },
    );

    // The opening `---` is a thematic break, not frontmatter, so the section it
    // introduces must stay editable rather than being hidden as metadata.
    await waitFor(() => {
      const editor = slot.container.querySelector(".tiptap");
      expect(editor?.textContent).toContain("Some intro text.");
      expect(editor?.textContent).toContain("More text.");
    });
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

  it("deletes a file directly from its context menu", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal/projects/old.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult(
              [
                {
                  path: "projects/old.md",
                  title: "Old note",
                  preview: "",
                  modifiedAtMs: 1,
                },
              ],
              [
                { kind: "directory", path: "projects" },
                { kind: "file", path: "projects/old.md" },
              ],
            ),
          readNote: () => ({ content: "# Old note", sha256: "sha" }),
          preparePreview: () => preview,
          renameToTitle: () => ({ path: "projects/old.md" }),
          deletePath: () => ({ ok: true }),
        },
      },
    );

    const file = await slot.findByRole("button", { name: /Old note/ });
    fireEvent.contextMenu(file);
    fireEvent.click(await slot.findByRole("menuitem", { name: "Delete" }));

    await waitFor(() => {
      expect(slot.rpcCalls).toContainEqual({
        method: "deletePath",
        input: { vaultId: "personal", path: "projects/old.md" },
      });
    });
    expect(slot.queryByText("Delete file?")).toBeNull();
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "docs",
      options: { subPath: "personal", replace: true },
    });
  });

  it("reorders files by dragging within a folder", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult([
              {
                path: "first.md",
                title: "First",
                preview: "",
                modifiedAtMs: 1,
              },
              {
                path: "second.md",
                title: "Second",
                preview: "",
                modifiedAtMs: 1,
              },
            ]),
          reorderFiles: () => ({ paths: ["second.md", "first.md"] }),
        },
      },
    );

    const first = await slot.findByRole("button", { name: "First" });
    const second = slot.getByRole("button", { name: "Second" });
    second.getBoundingClientRect = () => new DOMRect(0, 0, 100, 32);
    const dataTransfer = makeDataTransfer("first.md");
    fireEvent.dragStart(first, { dataTransfer });
    fireEvent.dragOver(second, { clientY: 31, dataTransfer });
    fireEvent.drop(second, { clientY: 31, dataTransfer });

    await waitFor(() => {
      expect(slot.rpcCalls).toContainEqual({
        method: "reorderFiles",
        input: {
          vaultId: "personal",
          parent: "",
          paths: ["second.md", "first.md"],
        },
      });
    });
  });

  it("moves a file when it is dropped onto a folder", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal/old.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult(
              [
                {
                  path: "old.md",
                  title: "Old note",
                  preview: "",
                  modifiedAtMs: 1,
                },
              ],
              [
                { kind: "directory", path: "projects" },
                { kind: "file", path: "old.md" },
              ],
            ),
          readNote: () => ({ content: "# Old note", sha256: "sha" }),
          preparePreview: () => preview,
          renameToTitle: () => ({ path: "old.md" }),
          movePath: () => ({ path: "projects/old.md" }),
        },
      },
    );

    const file = await slot.findByRole("button", { name: "Old note" });
    const folder = slot.getByRole("button", { name: "projects" });
    const dataTransfer = makeDataTransfer("old.md");
    fireEvent.dragStart(file, { dataTransfer });
    fireEvent.dragOver(folder, { dataTransfer });
    fireEvent.drop(folder, { dataTransfer });

    await waitFor(() => {
      expect(slot.rpcCalls).toContainEqual({
        method: "movePath",
        input: {
          vaultId: "personal",
          from: "old.md",
          to: "projects/old.md",
        },
      });
    });
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "docs",
      options: {
        subPath: "personal/projects/old.md",
        replace: true,
      },
    });
  });

  it("moves a nested file back to the top level", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "personal/projects/old.md" },
      {
        rpc: {
          listNotes: () =>
            listNotesResult(
              [
                {
                  path: "projects/old.md",
                  title: "Old note",
                  preview: "",
                  modifiedAtMs: 1,
                },
              ],
              [
                { kind: "directory", path: "projects" },
                { kind: "file", path: "projects/old.md" },
              ],
            ),
          readNote: () => ({ content: "# Old note", sha256: "sha" }),
          preparePreview: () => preview,
          renameToTitle: () => ({ path: "projects/old.md" }),
          movePath: () => ({ path: "old.md" }),
        },
      },
    );

    const file = await slot.findByRole("button", { name: "Old note" });
    expect(
      slot.queryByRole("button", { name: "Move to top level" }),
    ).toBeNull();
    const dataTransfer = makeDataTransfer("projects/old.md");
    fireEvent.dragStart(file, { dataTransfer });
    const topLevel = slot.getByRole("button", { name: "Move to top level" });
    expect(topLevel.className).toContain("absolute");
    fireEvent.dragOver(topLevel, { dataTransfer });
    fireEvent.drop(topLevel, { dataTransfer });

    await waitFor(() => {
      expect(slot.rpcCalls).toContainEqual({
        method: "movePath",
        input: {
          vaultId: "personal",
          from: "projects/old.md",
          to: "old.md",
        },
      });
    });
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "docs",
      options: { subPath: "personal/old.md", replace: true },
    });
  });

  it("opens Docs directive cards in the thread panel or full editor", () => {
    const openThreadPanel = vi.fn(() => true);
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
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
      },
      { openThreadPanel },
    );

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
    expect(slot.queryByRole("button", { name: "Add to chat" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Mention in chat" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Open in Docs" }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "docs",
      options: { subPath: "personal/plans/release.md" },
    });
  });

  it("opens arbitrary Markdown files without exposing composer actions", async () => {
    const slot = renderSlot(
      app.fileOpeners[0]!,
      {
        path: "notes/plan.mdx",
        source: {
          kind: "workspace",
          threadId: "thr_1",
          environmentId: "env_1",
          projectId: "project_1",
        },
      },
      {
        rpc: {
          openFile: () => ({
            file: { content: "# Workspace plan", sha256: "sha" },
            preview,
            previewPath: "notes/plan.mdx",
          }),
        },
      },
    );

    await slot.findByText("Workspace plan");
    expect(slot.queryByRole("button", { name: "Add to chat" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Mention in chat" })).toBeNull();
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
