// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

let app: Awaited<ReturnType<typeof loadPluginApp>>;

beforeEach(async () => {
  app = await loadPluginApp(() => import("./app"));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

const message = {
  id: "msg_1",
  threadId: "thr_1",
  turnId: "turn_1",
  projectId: "proj_1",
};

function directiveProps(attributes: Record<string, string>) {
  const source = `::inline-vis{${Object.entries(attributes)
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ")}}`;
  return { attributes, source, message, openWorkspaceFile: null };
}

function htmlPreview(
  file: string,
  overrides: { content?: string; sha256?: string } = {},
) {
  return {
    kind: "html" as const,
    file,
    source: "workspace" as const,
    target: { kind: "workspace" as const, environmentId: "env_1", path: file },
    url: `/api/v1/environments/env_1/files/${file
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    content: overrides.content ?? "<h1>Demo</h1>",
    sha256: overrides.sha256 ?? `sha-${file}`,
  };
}

async function findFrame(slot: {
  container: HTMLElement;
}): Promise<HTMLIFrameElement> {
  return waitFor(() => {
    const el = slot.container.querySelector("iframe");
    if (!(el instanceof HTMLIFrameElement)) {
      throw new Error("Expected the inline visualization iframe to render");
    }
    return el;
  });
}

function frameBox(iframe: HTMLIFrameElement): HTMLElement {
  const box = iframe.closest("[data-inline-vis-frame]");
  if (!(box instanceof HTMLElement)) {
    throw new Error("Expected the iframe to sit in an inline-vis frame");
  }
  return box;
}

function postMessageFrom(source: Window | null, data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

function markdownPreview(file: string, content: string) {
  return {
    kind: "markdown" as const,
    file,
    source: "workspace" as const,
    target: { kind: "workspace" as const, environmentId: "env_1", path: file },
    rootPath: "/work/repo",
    content,
  };
}

function observeDocumentHeights() {
  const observed = new Map<Element, () => void>();
  let height = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly notify: () => void;
      constructor(callback: ResizeObserverCallback) {
        this.notify = () => callback([], this as unknown as ResizeObserver);
      }
      observe(element: Element) {
        observed.set(element, this.notify);
      }
      disconnect() {
        for (const [element, notify] of observed) {
          if (notify === this.notify) observed.delete(element);
        }
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 700, height),
  );
  return {
    report(next: number) {
      height = next;
      act(() => {
        for (const notify of observed.values()) notify();
      });
    },
  };
}

function documentBody(slot: { container: HTMLElement }): HTMLElement {
  const body = slot.container.querySelector("[data-inline-vis-document]");
  if (!(body instanceof HTMLElement)) {
    throw new Error("Expected the Markdown document body to render");
  }
  return body;
}

function sizeChanged(height: number) {
  return {
    jsonrpc: "2.0",
    method: "ui/notifications/size-changed",
    params: { height },
  };
}

describe("inline-vis messageDirective registration", () => {
  it("registers the inline-vis directive", () => {
    expect(app.messageDirectives).toHaveLength(1);
    expect(app.messageDirectives[0]!.id).toBe("inline-vis");
  });
});

describe("InlineVisDirective", () => {
  it.each(["not-found", "disconnected"] as const)(
    "revalidates a cached Markdown preview after %s and does not resurrect missing content",
    async (failure) => {
      const props = {
        attributes: { file: "notes.md" },
        source: '::inline-vis{file="notes.md"}',
        message,
        openWorkspaceFile: null,
      };
      const first = renderSlot(app.messageDirectives[0]!, props, {
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
            content: "Previously loaded notes",
          }),
        },
      });
      await first.findByText("Previously loaded notes");
      first.unmount();
      const options = {
        rpc: {
          preparePreview: () => {
            if (failure === "disconnected") throw new Error("Connection lost");
            return { kind: "not-found", file: "notes.md" };
          },
        },
      };
      const second = renderSlot(app.messageDirectives[0]!, props, options);
      if (failure === "not-found") {
        expect((await second.findByRole("alert")).textContent).toContain(
          "Preview file not found: notes.md",
        );
        expect(second.queryByText("Previously loaded notes")).toBeNull();
        second.unmount();
        const third = renderSlot(app.messageDirectives[0]!, props, options);
        expect(third.queryByText("Previously loaded notes")).toBeNull();
        await third.findByRole("alert");
      } else {
        await waitFor(() => expect(second.rpcCalls).toHaveLength(1));
        expect(second.getByText("Previously loaded notes")).toBeTruthy();
        expect(second.queryByRole("alert")).toBeNull();
      }
    },
  );

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

  it("renders an HTML page in a borderless opaque-origin frame built from its content", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "charts/demo file.html" }),
      {
        rpc: {
          preparePreview: (input) => {
            expect(input).toEqual({
              threadId: "thr_1",
              file: "charts/demo file.html",
            });
            return htmlPreview("charts/demo file.html", {
              content: "<h1>Quarterly chart</h1>",
            });
          },
        },
      },
    );

    await slot.findByRole("status", {
      name: "Loading visualization charts/demo file.html",
    });
    const iframe = await findFrame(slot);

    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(iframe.getAttribute("src")).toBeNull();
    expect(iframe.title).toBe("inline-vis: charts/demo file.html");
    const srcDoc = iframe.getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain("<h1>Quarterly chart</h1>");
    expect(srcDoc).toContain('<style id="bb-theme">:root{color-scheme:light;');
    expect(srcDoc).toContain(
      `<base href="${window.location.origin}/api/v1/environments/env_1/files/charts/demo%20file.html">`,
    );
    expect(frameBox(iframe).style.height).toBe("224px");
    expect(slot.queryByRole("status")).toBeNull();
    expect(slot.queryByRole("button")).toBeNull();
    expect(slot.queryByText("inline-vis")).toBeNull();

    const open = slot.getByRole("link", {
      name: "Open charts/demo file.html in sidebar",
    });
    expect(frameBox(iframe).contains(open)).toBe(true);
    expect(frameBox(iframe).classList.contains("group/inline-vis")).toBe(true);
    expect(open.parentElement?.className).toContain("opacity-0");
    expect(open.parentElement?.className).toContain(
      "group-hover/inline-vis:opacity-100",
    );
    expect(open.parentElement?.className).toContain("focus-within:opacity-100");
    expect(open.parentElement?.className).toContain(
      "pointer-coarse:opacity-100",
    );
    fireEvent.click(open);
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
      directiveProps({
        source: "thread-storage",
        file: "reports/result file.html",
      }),
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
              url: "/api/v1/threads/thr_1/thread-storage/files/reports/result%20file.html",
              content: "<p>report</p>",
              sha256: "sha-thread-storage-report",
            };
          },
        },
      },
    );

    const iframe = await findFrame(slot);
    expect(iframe.getAttribute("srcdoc")).toContain(
      `<base href="${window.location.origin}/api/v1/threads/thr_1/thread-storage/files/reports/result%20file.html">`,
    );
    fireEvent.click(
      slot.getByRole("link", {
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

  it("leaves modified clicks on the open action to the browser so they open the page itself", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "demo.html" }),
      { rpc: { preparePreview: () => htmlPreview("demo.html") } },
    );

    const open = await slot.findByRole("link", {
      name: "Open demo.html in sidebar",
    });
    expect(open.getAttribute("href")).toBe(
      "/api/v1/environments/env_1/files/demo.html",
    );
    expect(open.getAttribute("target")).toBe("_blank");
    expect(fireEvent.click(open, { metaKey: true })).toBe(true);
    expect(fireEvent.click(open, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(open, { shiftKey: true })).toBe(true);
    expect(fireEvent.click(open, { button: 1 })).toBe(true);
    expect(slot.navigateCalls).toEqual([]);

    expect(fireEvent.click(open)).toBe(false);
    expect(slot.navigateCalls).toEqual([
      {
        method: "experimental_openFilePreview",
        options: {
          target: {
            kind: "workspace",
            environmentId: "env_1",
            path: "demo.html",
          },
          location: null,
        },
      },
    ]);
  });

  it("fits the frame to the height its own page reports, remembers it, and honours a height cap", async () => {
    const options = {
      rpc: {
        preparePreview: () => htmlPreview("fit.html", { sha256: "sha-fit" }),
      },
    };
    const first = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "fit.html" }),
      options,
    );
    const iframe = await findFrame(first);
    expect(frameBox(iframe).style.height).toBe("224px");

    postMessageFrom(window, sizeChanged(640));
    expect(frameBox(iframe).style.height).toBe("224px");

    postMessageFrom(iframe.contentWindow, sizeChanged(640));
    expect(frameBox(iframe).style.height).toBe("640px");

    postMessageFrom(iframe.contentWindow, sizeChanged(12));
    expect(frameBox(iframe).style.height).toBe("80px");

    postMessageFrom(iframe.contentWindow, sizeChanged(640));
    first.unmount();

    const second = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "fit.html" }),
      options,
    );
    expect(frameBox(await findFrame(second)).style.height).toBe("640px");
    second.unmount();

    const capped = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "fit.html", height: "300" }),
      options,
    );
    const cappedFrame = await findFrame(capped);
    expect(frameBox(cappedFrame).style.height).toBe("300px");
    postMessageFrom(cappedFrame.contentWindow, sizeChanged(120));
    expect(frameBox(cappedFrame).style.height).toBe("120px");
  });

  it("opens a link the page requests only while the frame has focus", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const slot = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "links.html" }),
      { rpc: { preparePreview: () => htmlPreview("links.html") } },
    );
    const iframe = await findFrame(slot);
    const request = {
      jsonrpc: "2.0",
      id: "bb-link-1",
      method: "ui/open-link",
      params: { url: "https://example.com/docs" },
    };

    postMessageFrom(iframe.contentWindow, request);
    expect(open).not.toHaveBeenCalled();

    iframe.focus();
    expect(document.activeElement).toBe(iframe);
    postMessageFrom(window, request);
    postMessageFrom(iframe.contentWindow, {
      ...request,
      params: { url: "javascript:alert(1)" },
    });
    expect(open).not.toHaveBeenCalled();

    postMessageFrom(iframe.contentWindow, request);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      "https://example.com/docs",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("sends the page the new theme when the app switches appearance", async () => {
    const slot = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "themed.html" }),
      { rpc: { preparePreview: () => htmlPreview("themed.html") } },
    );
    const iframe = await findFrame(slot);
    const post = vi.spyOn(iframe.contentWindow!, "postMessage");

    document.documentElement.classList.add("dark");

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "ui/notifications/host-context-changed",
          params: expect.objectContaining({ theme: "dark" }),
        }),
        "*",
      );
    });
  });

  it("clamps a tall Markdown document to a preview, expands it in place, and keeps the choice across a remount", async () => {
    const heights = observeDocumentHeights();
    const options = {
      rpc: { preparePreview: () => markdownPreview("plan.md", "# Plan") },
    };
    const props = directiveProps({ file: "plan.md" });
    const first = renderSlot(app.messageDirectives[0]!, props, options);
    await first.findByTestId("bb-markdown");
    heights.report(900);

    expect(documentBody(first).style.maxHeight).toBe("256px");
    const more = first.getByRole("button", { name: "Show more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);

    expect(documentBody(first).style.maxHeight).toBe("");
    expect(
      first
        .getByRole("button", { name: "Show less" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(first.getByTestId("bb-markdown")).toBeTruthy();
    first.unmount();

    const second = renderSlot(app.messageDirectives[0]!, props, options);
    await second.findByTestId("bb-markdown");
    heights.report(900);
    expect(documentBody(second).style.maxHeight).toBe("");

    fireEvent.click(second.getByRole("button", { name: "Show less" }));
    expect(documentBody(second).style.maxHeight).toBe("256px");
    second.unmount();

    const third = renderSlot(app.messageDirectives[0]!, props, options);
    await third.findByTestId("bb-markdown");
    heights.report(900);
    expect(documentBody(third).style.maxHeight).toBe("256px");
  });

  it("shows a Markdown document whole, with no expand control, when it barely exceeds the preview", async () => {
    const heights = observeDocumentHeights();
    const slot = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "short.md" }),
      { rpc: { preparePreview: () => markdownPreview("short.md", "# Short") } },
    );
    await slot.findByTestId("bb-markdown");
    expect(documentBody(slot).style.maxHeight).toBe("256px");

    heights.report(300);

    expect(documentBody(slot).style.maxHeight).toBe("");
    expect(slot.queryByRole("button", { name: "Show more" })).toBeNull();

    heights.report(321);
    expect(documentBody(slot).style.maxHeight).toBe("256px");
    expect(slot.getByRole("button", { name: "Show more" })).toBeTruthy();
  });

  it("uses the height attribute as the Markdown preview height", async () => {
    const heights = observeDocumentHeights();
    const slot = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "tall.md", height: "480" }),
      { rpc: { preparePreview: () => markdownPreview("tall.md", "# Tall") } },
    );
    await slot.findByTestId("bb-markdown");
    heights.report(900);
    expect(documentBody(slot).style.maxHeight).toBe("480px");
    heights.report(500);
    expect(documentBody(slot).style.maxHeight).toBe("");
  });

  it("copies the Markdown source from the card header", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const slot = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "copy.md" }),
      {
        rpc: {
          preparePreview: () => markdownPreview("copy.md", "# Copy\n\nBody"),
        },
      },
    );
    await slot.findByTestId("bb-markdown");
    const copy = slot.getByRole("button", { name: "Copy copy.md" });
    fireEvent.click(copy);

    expect(writeText).toHaveBeenCalledWith("# Copy\n\nBody");
    await waitFor(() => expect(copy.getAttribute("title")).toBe("Copied"));
  });

  it("reserves blank space with no card while an HTML page loads", async () => {
    type HtmlPreview = ReturnType<typeof htmlPreview>;
    let resolvePreview = (_result: HtmlPreview) => {};
    const pendingPreview = new Promise<HtmlPreview>((resolve) => {
      resolvePreview = resolve;
    });
    window.localStorage.setItem("bb.inline-vis.collapsed", "true");
    const slot = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "pending.html", height: "480" }),
      { rpc: { preparePreview: () => pendingPreview } },
    );

    const loading = await slot.findByRole("status", {
      name: "Loading visualization pending.html",
    });
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(loading.style.height).toBe("480px");
    expect(loading.childElementCount).toBe(0);
    expect(loading.parentElement).toBe(slot.container);
    expect(slot.queryByRole("button")).toBeNull();

    resolvePreview(htmlPreview("pending.html"));

    const iframe = await findFrame(slot);
    expect(frameBox(iframe).style.height).toBe("480px");
    expect(slot.queryByRole("status")).toBeNull();
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
    const card = slot.getByRole("region", { name: "reports/notes.md" });
    const header = card.querySelector("header");
    expect(header?.textContent).toBe("notes.mdreports");
    expect(card.contains(markdown)).toBe(true);

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

  it("shows a loading card for a Markdown document, then the document in the same card", async () => {
    type MarkdownPreview = ReturnType<typeof markdownPreview>;
    let resolvePreview = (_result: MarkdownPreview) => {};
    const pendingPreview = new Promise<MarkdownPreview>((resolve) => {
      resolvePreview = resolve;
    });
    const slot = renderSlot(
      app.messageDirectives[0]!,
      directiveProps({ file: "notes.md" }),
      { rpc: { preparePreview: () => pendingPreview } },
    );

    const loading = await slot.findByRole("status");
    expect(loading.getAttribute("aria-label")).toBe(
      "Loading document notes.md",
    );
    const loadingCard = slot.getByRole("region", { name: "notes.md" });
    expect(loadingCard.contains(loading)).toBe(true);
    expect(slot.queryByRole("button", { name: "Copy notes.md" })).toBeNull();

    resolvePreview(markdownPreview("notes.md", "# Notes"));

    const markdown = await slot.findByTestId("bb-markdown");
    expect(slot.queryByRole("status")).toBeNull();
    const card = slot.getByRole("region", { name: "notes.md" });
    expect(card.contains(markdown)).toBe(true);
    expect(card.className).toBe(loadingCard.className);
  });

  it.each([
    ["demo.html", "100vh"],
    ["demo.html", "79"],
    ["demo.html", "2001"],
    ["notes.md", "79"],
  ])(
    "rejects the height of %s set to %s without calling rpc",
    async (file, height) => {
      const slot = renderSlot(
        app.messageDirectives[0]!,
        directiveProps({ file, height }),
        { rpc: {} },
      );

      expect((await slot.findByRole("alert")).textContent).toMatch(
        /whole number from 80 to 2000 pixels/i,
      );
      expect(slot.container.querySelector("iframe")).toBeNull();
      expect(slot.rpcCalls).toEqual([]);
    },
  );
});

describe("InlineVisFence", () => {
  const Original = () => <pre data-testid="original">fence source</pre>;

  function fenceProps(
    overrides: Partial<{
      code: string;
      status: "streaming" | "closed" | "unclosed";
      messageId: string;
      index: number;
    }> = {},
  ) {
    return {
      code: overrides.code ?? "<p>Fenced chart</p>",
      language: "inline-vis",
      status: overrides.status ?? "closed",
      index: overrides.index ?? 0,
      message: { ...message, id: overrides.messageId ?? "msg_fence" },
      Original,
    };
  }

  it("registers the inline-vis fence language", () => {
    expect(app.codeFenceRenderers).toHaveLength(1);
    expect(app.codeFenceRenderers[0]!.id).toBe("inline-vis");
    expect(app.codeFenceRenderers[0]!.languages).toEqual(["inline-vis"]);
  });

  it("shows a quiet status line while the page streams, then frames the finished page", async () => {
    const Fence = app.codeFenceRenderers[0]!.component;
    const slot = renderSlot(
      app.codeFenceRenderers[0]!,
      fenceProps({ status: "streaming", code: "<p>Fenced" }),
    );

    expect(slot.getByRole("status").textContent).toBe("Writing visualization…");
    expect(slot.container.querySelector("iframe")).toBeNull();
    expect(slot.queryByTestId("original")).toBeNull();

    slot.rerender(<Fence {...fenceProps()} />);

    const iframe = await findFrame(slot);
    expect(slot.queryByRole("status")).toBeNull();
    expect(iframe.title).toBe("inline-vis");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    const srcDoc = iframe.getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain("<p>Fenced chart</p>");
    expect(srcDoc).toContain('<style id="bb-theme">:root{color-scheme:light;');
    expect(srcDoc).toContain(`<base href="${window.location.origin}/">`);
    expect(slot.queryByTestId("original")).toBeNull();
    expect(slot.rpcCalls).toEqual([]);
  });

  it.each([
    ["an unclosed fence", { status: "unclosed" as const }],
    ["a closed fence with no page", { code: " \n " }],
  ])("falls back to bb's code block for %s", (_label, overrides) => {
    const slot = renderSlot(app.codeFenceRenderers[0]!, fenceProps(overrides));

    expect(slot.getByTestId("original")).toBeTruthy();
    expect(slot.container.querySelector("iframe")).toBeNull();
    expect(slot.queryByRole("status")).toBeNull();
  });

  it("toggles the fence source below the frame", async () => {
    const slot = renderSlot(app.codeFenceRenderers[0]!, fenceProps());
    const iframe = await findFrame(slot);

    const show = slot.getByRole("button", { name: "Show source" });
    expect(show.getAttribute("aria-pressed")).toBe("false");
    expect(frameBox(iframe).contains(show)).toBe(true);
    fireEvent.click(show);

    const original = slot.getByTestId("original");
    expect(frameBox(iframe).nextElementSibling).toBe(original);
    expect(slot.container.querySelector("iframe")).toBe(iframe);
    const hide = slot.getByRole("button", { name: "Hide source" });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(hide);

    expect(slot.queryByTestId("original")).toBeNull();
    expect(slot.getByRole("button", { name: "Show source" })).toBeTruthy();
  });

  it("resizes to the height its own page reports and remembers it per message fence", async () => {
    const props = fenceProps({ messageId: "msg_fence_resize", index: 1 });
    const first = renderSlot(app.codeFenceRenderers[0]!, props);
    const iframe = await findFrame(first);
    expect(frameBox(iframe).style.height).toBe("224px");

    postMessageFrom(window, sizeChanged(512));
    expect(frameBox(iframe).style.height).toBe("224px");

    postMessageFrom(iframe.contentWindow, sizeChanged(512));
    expect(frameBox(iframe).style.height).toBe("512px");
    first.unmount();

    const again = renderSlot(app.codeFenceRenderers[0]!, props);
    expect(frameBox(await findFrame(again)).style.height).toBe("512px");
    again.unmount();

    const sibling = renderSlot(
      app.codeFenceRenderers[0]!,
      fenceProps({ messageId: "msg_fence_resize", index: 2 }),
    );
    expect(frameBox(await findFrame(sibling)).style.height).toBe("224px");
  });
});
