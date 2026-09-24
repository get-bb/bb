// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const message = {
  id: "msg_1",
  threadId: "thr_1",
  turnId: "turn_1",
  projectId: "proj_1",
};

describe("inline-vis messageDirective registration", () => {
  it("registers the inline-vis directive", () => {
    expect(app.messageDirectives).toHaveLength(1);
    expect(app.messageDirectives[0]!.id).toBe("inline-vis");
  });
});

describe("InlineVisDirective", () => {
  it("requires a file attribute without calling rpc", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: {},
        source: "::inline-vis{}",
        message,
        openWorkspaceFile: null,
      },
      { rpc: {} },
    );

    await slot.findByRole("alert");
    expect(slot.getByText(/requires a file attribute/i)).toBeTruthy();
    expect(slot.rpcCalls).toEqual([]);
  });

  it("shows the rpc validation error for an unknown source", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "demo.html", source: "project" },
        source: '::inline-vis{source="project" file="demo.html"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: (input) => {
            expect(input).toEqual({
              threadId: "thr_1",
              file: "demo.html",
              source: "project",
            });
            throw new Error(
              'Invalid option: expected "workspace"|"thread-storage"',
            );
          },
        },
      },
    );

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(
      /expected "workspace"\|"thread-storage"/i,
    );
    expect(slot.container.querySelector("iframe")).toBeNull();
    expect(slot.rpcCalls).toEqual([
      {
        method: "preparePreview",
        input: {
          threadId: "thr_1",
          file: "demo.html",
          source: "project",
        },
      },
    ]);
  });

  it("uses the sidebar worktree route with an opaque-origin script sandbox", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "charts/demo file.html" },
        source: '::inline-vis{file="charts/demo file.html"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: (input) => {
            expect(input).toEqual({
              threadId: "thr_1",
              file: "charts/demo file.html",
            });
            return {
              kind: "html",
              file: "charts/demo file.html",
              source: "workspace",
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "charts/demo file.html",
              },
            };
          },
        },
      },
    );

    await slot.findByRole("status", {
      name: "Loading visualization charts/demo file.html",
    });

    const iframe = await waitFor(() => {
      const el = slot.container.querySelector("iframe");
      expect(el).toBeTruthy();
      return el as HTMLIFrameElement;
    });

    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.getAttribute("src")).toBe(
      "/api/v1/threads/thr_1/worktree/files/charts/demo%20file.html",
    );
    expect(iframe.getAttribute("srcdoc")).toBeNull();
    expect(iframe.style.height).toBe("224px");
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open charts/demo file.html in sidebar",
      }),
    );
    expect(slot.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: {
            kind: "workspace",
            environmentId: "env_1",
            path: "charts/demo file.html",
          },
          location: null,
        },
      },
    ]);
    expect(slot.rpcCalls).toEqual([
      {
        method: "preparePreview",
        input: {
          threadId: "thr_1",
          file: "charts/demo file.html",
        },
      },
    ]);
  });

  it("opens a thread-storage preview through its thread-storage target", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: {
          source: "thread-storage",
          file: "reports/result file.html",
        },
        source:
          '::inline-vis{source="thread-storage" file="reports/result file.html"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: (input) => {
            expect(input).toEqual({
              threadId: "thr_1",
              file: "reports/result file.html",
              source: "thread-storage",
            });
            return {
              kind: "html",
              file: "reports/result file.html",
              source: "thread-storage",
              target: {
                kind: "thread-storage",
                threadId: "thr_1",
                path: "reports/result file.html",
              },
            };
          },
        },
      },
    );

    const iframe = await waitFor(() => {
      const el = slot.container.querySelector("iframe");
      expect(el).toBeTruthy();
      return el as HTMLIFrameElement;
    });

    expect(iframe.getAttribute("src")).toBe(
      "/api/v1/threads/thr_1/thread-storage/files/reports/result%20file.html",
    );
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open reports/result file.html in sidebar",
      }),
    );
    expect(slot.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: {
            kind: "thread-storage",
            threadId: "thr_1",
            path: "reports/result file.html",
          },
          location: null,
        },
      },
    ]);
  });

  it("uses an optional bounded height attribute", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "demo.html", height: "480" },
        source: '::inline-vis{file="demo.html" height="480"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: () => ({
            kind: "html",
            file: "demo.html",
            source: "workspace",
            target: {
              kind: "workspace",
              environmentId: "env_1",
              path: "demo.html",
            },
          }),
        },
      },
    );

    const iframe = await waitFor(() => {
      const el = slot.container.querySelector("iframe");
      expect(el).toBeTruthy();
      return el as HTMLIFrameElement;
    });
    expect(iframe.style.height).toBe("480px");
  });

  it("persists the collapsed preference for subsequent previews", async () => {
    const options = {
      rpc: {
        preparePreview: () => ({
          kind: "html" as const,
          file: "demo.html",
          source: "workspace" as const,
          target: {
            kind: "workspace" as const,
            environmentId: "env_1",
            path: "demo.html",
          },
        }),
      },
    };
    const props = {
      attributes: { file: "demo.html" },
      source: '::inline-vis{file="demo.html"}',
      message,
      openWorkspaceFile: null,
    };
    const first = renderSlot(app.messageDirectives[0]!, props, options);

    await waitFor(() => {
      expect(first.container.querySelector("iframe")).toBeTruthy();
    });
    const collapse = first.getByRole("button", {
      name: "Collapse visualization demo.html",
    });
    const header = collapse.parentElement!;
    expect(header.classList.contains("border-b")).toBe(true);
    fireEvent.click(collapse);

    expect(first.container.querySelector("iframe")).toBeNull();
    expect(header.classList.contains("border-b")).toBe(false);
    expect(window.localStorage.getItem("bb.inline-vis.collapsed")).toBe("true");
    first.unmount();

    const second = renderSlot(app.messageDirectives[0]!, props, options);
    const expand = await second.findByRole("button", {
      name: "Expand visualization demo.html",
    });
    expect(second.container.querySelector("iframe")).toBeNull();

    fireEvent.click(expand);

    await waitFor(() => {
      expect(second.container.querySelector("iframe")).toBeTruthy();
    });
    expect(window.localStorage.getItem("bb.inline-vis.collapsed")).toBe(
      "false",
    );
  });

  it("reserves the preview height while loading so the timeline does not jump", async () => {
    type HtmlPreview = {
      kind: "html";
      file: string;
      source: "workspace" | "thread-storage";
      target: { kind: "workspace"; environmentId: string; path: string };
    };
    let resolvePreview = (_result: HtmlPreview) => {};
    const pendingPreview = new Promise<HtmlPreview>((resolve) => {
      resolvePreview = resolve;
    });
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "demo.html", height: "480" },
        source: '::inline-vis{file="demo.html" height="480"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: () => pendingPreview,
        },
      },
    );

    const loading = await waitFor(() => {
      const el = slot.container.querySelector('[aria-busy="true"]');
      if (!(el instanceof HTMLElement)) {
        throw new Error("Expected the inline visualization loader to render");
      }
      return el;
    });
    expect(loading.style.height).toBe("480px");
    expect(
      slot.getByRole("status", { name: "Loading visualization demo.html" }),
    ).toBe(loading);
    const loadingCard = loading.parentElement!;
    const loadingHeader = loadingCard.firstElementChild!;
    const loadingHeaderHtml = loadingHeader.outerHTML;

    resolvePreview({
      kind: "html",
      file: "demo.html",
      source: "workspace",
      target: {
        kind: "workspace",
        environmentId: "env_1",
        path: "demo.html",
      },
    });

    const iframe = await waitFor(() => {
      const el = slot.container.querySelector("iframe");
      if (!(el instanceof HTMLIFrameElement)) {
        throw new Error("Expected the inline visualization iframe to render");
      }
      return el;
    });
    expect(iframe.style.height).toBe("480px");
    expect(slot.queryByRole("status")).toBeNull();

    const readyCard = iframe.parentElement!;
    expect(readyCard.className).toBe(loadingCard.className);
    const readyHeader = readyCard.firstElementChild!;
    expect(readyHeader.className).toBe(loadingHeader.className);
    expect(readyHeader.lastElementChild!.classList.contains("size-5")).toBe(
      true,
    );
    expect(loadingHeaderHtml).toContain("size-5");
  });

  it("renders a Markdown document with the host renderer and no iframe", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "reports/notes.md" },
        source: '::inline-vis{file="reports/notes.md"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: (input) => {
            expect(input).toEqual({
              threadId: "thr_1",
              file: "reports/notes.md",
            });
            return {
              kind: "markdown",
              file: "reports/notes.md",
              source: "workspace",
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "reports/notes.md",
              },
              rootPath: "/work/repo",
              content: "# Notes\n\nReady for review.",
            };
          },
        },
      },
    );

    const markdown = await slot.findByTestId("bb-markdown");
    expect(markdown.textContent).toBe("# Notes\n\nReady for review.");
    expect(slot.container.querySelector("iframe")).toBeNull();
    expect(markdown.parentElement?.style.height).toBe("224px");
    expect(markdown.parentElement?.className).toContain("overflow-auto");

    fireEvent.click(
      slot.getByRole("button", {
        name: "Open reports/notes.md in sidebar",
      }),
    );
    expect(slot.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: {
            kind: "workspace",
            environmentId: "env_1",
            path: "reports/notes.md",
          },
          location: null,
        },
      },
    ]);
  });

  it("opens thread-storage Markdown through its thread-storage target", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { source: "thread-storage", file: "reports/notes.md" },
        source: '::inline-vis{source="thread-storage" file="reports/notes.md"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: () => ({
            kind: "markdown",
            file: "reports/notes.md",
            source: "thread-storage",
            target: {
              kind: "thread-storage",
              threadId: "thr_1",
              path: "reports/notes.md",
            },
            rootPath: "/storage/thr_1",
            content: "# Notes",
          }),
        },
      },
    );

    const markdown = await slot.findByTestId("bb-markdown");
    expect(markdown.textContent).toBe("# Notes");
    expect(slot.container.querySelector("iframe")).toBeNull();
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open reports/notes.md in sidebar",
      }),
    );
    expect(slot.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: {
            kind: "thread-storage",
            threadId: "thr_1",
            path: "reports/notes.md",
          },
          location: null,
        },
      },
    ]);
  });

  it("uses an optional bounded height for Markdown", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "notes.md", height: "480" },
        source: '::inline-vis{file="notes.md" height="480"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: () => ({
            kind: "markdown",
            file: "notes.md",
            source: "workspace",
            target: {
              kind: "workspace",
              environmentId: "env_1",
              path: "notes.md",
            },
            rootPath: "/work/repo",
            content: "# Notes",
          }),
        },
      },
    );

    const markdown = await slot.findByTestId("bb-markdown");
    expect(markdown.parentElement?.style.height).toBe("480px");
  });

  it("reserves the Markdown preview height while loading", async () => {
    type MarkdownPreview = {
      kind: "markdown";
      file: string;
      source: "workspace";
      target: { kind: "workspace"; environmentId: string; path: string };
      rootPath: string;
      content: string;
    };
    let resolvePreview = (_result: MarkdownPreview) => {};
    const pendingPreview = new Promise<MarkdownPreview>((resolve) => {
      resolvePreview = resolve;
    });
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "notes.md", height: "480" },
        source: '::inline-vis{file="notes.md" height="480"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: () => pendingPreview,
        },
      },
    );

    const loading = await waitFor(() => {
      const el = slot.container.querySelector('[aria-busy="true"]');
      if (!(el instanceof HTMLElement)) {
        throw new Error("Expected the inline visualization loader to render");
      }
      return el;
    });
    expect(loading.style.height).toBe("480px");
    const loadingCard = loading.parentElement!;

    resolvePreview({
      kind: "markdown",
      file: "notes.md",
      source: "workspace",
      target: {
        kind: "workspace",
        environmentId: "env_1",
        path: "notes.md",
      },
      rootPath: "/work/repo",
      content: "# Notes",
    });

    const markdown = await slot.findByTestId("bb-markdown");
    const markdownBody = markdown.parentElement!;
    expect(markdownBody.style.height).toBe("480px");
    expect(slot.queryByRole("status")).toBeNull();
    expect(markdownBody.parentElement!.className).toBe(loadingCard.className);
  });

  it("rejects an invalid height without calling rpc", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "demo.html", height: "100vh" },
        source: '::inline-vis{file="demo.html" height="100vh"}',
        message,
        openWorkspaceFile: null,
      },
      { rpc: {} },
    );

    expect((await slot.findByRole("alert")).textContent).toMatch(
      /whole number from 120 to 1200 pixels/i,
    );
    expect(slot.container.querySelector("iframe")).toBeNull();
    expect(slot.rpcCalls).toEqual([]);
  });

  it("shows an error when rpc fails", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { file: "missing.html" },
        source: '::inline-vis{file="missing.html"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: () => {
            throw new Error("Preview file not found: missing.html");
          },
        },
      },
    );

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(/Preview file not found: missing\.html/);
    expect(slot.container.querySelector("iframe")).toBeNull();
  });
});
