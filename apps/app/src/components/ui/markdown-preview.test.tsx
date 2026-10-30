// @vitest-environment jsdom

import { defaultExperiments } from "@bb/domain";
import { appQueryClient } from "@/lib/app-query-client";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { ApplicationUrlDialog } from "@/components/ApplicationUrlDialog";
import { resolveApplicationUrlConfirmation } from "@/lib/application-url";
import { LazyMarkdownHtml } from "./lazy-markdown-html";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { highlightMarkdownCode } from "./markdown-code-highlight";
import { MarkdownPreview } from "./markdown-preview";
import { MARKDOWN_TABLE_START_OFFSET_VARIABLE } from "./markdown-table-breakout";
import {
  MarkdownLocalFileContextMenuContext,
  MarkdownLocalFileOpenTargetsContext,
  type MarkdownLinkRouting,
} from "./markdown-link-routing";

const workspaceLinkRouting = {
  localFile: {
    absoluteLinks: {
      kind: "trusted-host",
    },
    relativeLinks: {
      baseDir: "/workspace",
      rootPath: "/workspace",
    },
    onOpenLink: vi.fn(() => true),
  },
} satisfies MarkdownLinkRouting;

beforeAll(() => LazyMarkdownHtml.preload());

afterEach(() => {
  resolveApplicationUrlConfirmation("cancel");
  cleanup();
  appQueryClient.removeQueries({ queryKey: systemConfigQueryKey() });
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function mockResizeObserverDeliveries(): {
  notifyResize: () => void;
  observerCount: () => number;
  observed: Element[];
} {
  const observed: Element[] = [];
  const observers: Array<{
    callback: ResizeObserverCallback;
    instance: ResizeObserver;
    targets: Set<Element>;
  }> = [];

  class ResizeObserverMock {
    private readonly record: (typeof observers)[number];
    constructor(callback: ResizeObserverCallback) {
      this.record = {
        callback,
        instance: this as unknown as ResizeObserver,
        targets: new Set(),
      };
      observers.push(this.record);
    }
    observe(target: Element): void {
      observed.push(target);
      this.record.targets.add(target);
    }
    unobserve(target: Element): void {
      this.record.targets.delete(target);
    }
    disconnect(): void {
      this.record.targets.clear();
    }
  }

  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  return {
    observed,
    observerCount: () => observers.length,
    notifyResize: () => {
      act(() => {
        for (const { callback, instance, targets } of observers) {
          if (targets.size === 0) continue;
          callback(
            Array.from(
              targets,
              (target) => ({ target }) as unknown as ResizeObserverEntry,
            ),
            instance,
          );
        }
      });
    },
  };
}

function requireElement(container: ParentNode, selector: string): Element {
  const element = container.querySelector(selector);
  if (element === null) {
    throw new Error(`Expected an element matching ${selector}`);
  }
  return element;
}

describe("MarkdownPreview", () => {
  it("shares one observer and observes content width only for table previews", () => {
    const { notifyResize, observed, observerCount } =
      mockResizeObserverDeliveries();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 320,
      top: 0,
      width: 320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const plain = render(<MarkdownPreview content="Plain paragraph" />);
    expect(observed).toHaveLength(0);
    plain.unmount();

    const { container } = render(
      <>
        <MarkdownPreview content={"| A |\n| - |\n| B |"} />
        <MarkdownPreview content={"| C |\n| - |\n| D |"} />
      </>,
    );
    const breakouts = Array.from(
      container.querySelectorAll("table"),
      (table) => table.parentElement?.parentElement,
    );

    expect(observerCount()).toBe(1);
    expect(observed).toHaveLength(2);
    expect(
      observed.every((element) =>
        element.hasAttribute("data-markdown-preview"),
      ),
    ).toBe(true);
    expect(
      breakouts.every(
        (breakout) => breakout?.style.getPropertyValue("--md-content-w") === "",
      ),
    ).toBe(true);
    notifyResize();
    expect(
      breakouts.every(
        (breakout) =>
          breakout?.style.getPropertyValue("--md-content-w") === "320px",
      ),
    ).toBe(true);
  });

  it("caps the table breakout at the nearest horizontally clipped ancestor", () => {
    const { notifyResize } = mockResizeObserverDeliveries();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const left = Number(this.dataset.left ?? 100);
        const width = Number(this.dataset.width ?? 300);
        return {
          bottom: 10,
          height: 10,
          left,
          right: left + width,
          top: 0,
          width,
          x: left,
          y: 0,
          toJSON: () => ({}),
        };
      },
    );
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(
      function (this: Element) {
        return Number((this as HTMLElement).dataset.width ?? 300);
      },
    );

    const renderClipped = (clipWidth: number) =>
      render(
        <div
          data-left="0"
          data-width={String(clipWidth)}
          style={{ overflowX: "hidden" }}
        >
          <MarkdownPreview content={"| A |\n| - |\n| B |"} />
        </div>,
      );

    const flush = renderClipped(400);
    const flushBreakout =
      flush.container.querySelector("table")?.parentElement?.parentElement;
    notifyResize();
    expect(
      flushBreakout?.style.getPropertyValue("--md-table-breakout-max"),
    ).toBe("300px");
    flush.unmount();

    const roomy = renderClipped(600);
    const roomyBreakout =
      roomy.container.querySelector("table")?.parentElement?.parentElement;
    notifyResize();
    expect(
      roomyBreakout?.style.getPropertyValue("--md-table-breakout-max"),
    ).toBe("500px");
    roomy.unmount();

    const sheet = document.createElement("style");
    sheet.textContent = ".overflow-x-hidden { overflow-x: hidden; }";
    document.head.appendChild(sheet);
    const rooted = render(
      <div data-left="0" data-width="600">
        <MarkdownPreview
          className="overflow-x-hidden"
          content={"| A |\n| - |\n| B |"}
        />
      </div>,
    );
    const rootedBreakout =
      rooted.container.querySelector("table")?.parentElement?.parentElement;
    notifyResize();
    expect(
      rootedBreakout?.style.getPropertyValue("--md-table-breakout-max"),
    ).toBe("300px");
    sheet.remove();
    rooted.unmount();

    const startAlignedSheet = document.createElement("style");
    startAlignedSheet.textContent = `.start-aligned [data-markdown-preview] { ${MARKDOWN_TABLE_START_OFFSET_VARIABLE}: 0px; }`;
    document.head.appendChild(startAlignedSheet);
    const startAligned = render(
      <div
        className="start-aligned"
        data-left="0"
        data-width="1200"
        style={{ overflowX: "hidden" }}
      >
        <MarkdownPreview content={"| A |\n| - |\n| B |"} />
      </div>,
    );
    const startAlignedBreakout =
      startAligned.container.querySelector("table")?.parentElement
        ?.parentElement;
    notifyResize();
    expect(
      startAlignedBreakout?.style.getPropertyValue("--md-table-breakout-max"),
    ).toBe("calc(1100px - 1rem)");
    startAlignedSheet.remove();
  });

  it("skips height-only resize events for tables", () => {
    const { notifyResize } = mockResizeObserverDeliveries();
    let width = 320;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({
        bottom: 0,
        height: 0,
        left: 0,
        right: width,
        top: 0,
        width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    );

    const { container } = render(
      <MarkdownPreview content={"| A |\n| - |\n| B |"} />,
    );
    const breakout = container.querySelector("table")?.parentElement
      ?.parentElement as HTMLElement;
    expect(breakout.style.getPropertyValue("--md-content-w")).toBe("");
    notifyResize();
    expect(breakout.style.getPropertyValue("--md-content-w")).toBe("320px");

    breakout.style.setProperty("--md-content-w", "sentinel");
    notifyResize();
    expect(breakout.style.getPropertyValue("--md-content-w")).toBe("sentinel");

    width = 480;
    notifyResize();
    expect(breakout.style.getPropertyValue("--md-content-w")).toBe("480px");
  });

  it("keeps the starting number of an ordered list", () => {
    const { container } = render(
      <MarkdownPreview content={"> 2. What happens if debt is unpaid?"} />,
    );

    expect(container.querySelector("ol")?.getAttribute("start")).toBe("2");
  });

  it("HTML-escapes fenced code so it cannot inject markup", () => {
    const { container } = render(
      <MarkdownPreview
        content={'```ts\nconst html = "<script>alert(1)</script>";\n```'}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("keeps highlighted code DOM until the code text changes", () => {
    const fence = "```ts\nconst a = 1;\n```";
    const view = render(<MarkdownPreview content={`${fence}\n\nPara one.`} />);
    const code = requireElement(view.container, "pre code");
    const line = requireElement(code, "span.sh__line");
    const observer = new MutationObserver(() => {});
    observer.observe(code, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    view.rerender(
      <MarkdownPreview content={`${fence}\n\nPara one.\n\nPara two.`} />,
    );

    const mutations = observer.takeRecords();
    observer.disconnect();
    expect(view.container.textContent).toContain("Para two.");
    expect(mutations).toHaveLength(0);
    expect(line.isConnected).toBe(true);

    view.rerender(
      <MarkdownPreview
        content={"```ts\nconst a = 1;\nconst b = 2;\n```\n\nPara one."}
      />,
    );

    const expected = document.createElement("code");
    expected.innerHTML = highlightMarkdownCode({
      code: "const a = 1;\nconst b = 2;",
      language: "ts",
    });
    expect(requireElement(view.container, "pre code")).toBe(code);
    expect(code.innerHTML).toBe(expected.innerHTML);
    expect(code.querySelectorAll("span.sh__line")).toHaveLength(2);
  });

  it.each([
    ["README.md", "/workspace/README.md", null],
    ["docs/guide.markdown:4", "/workspace/docs/guide.markdown", 4],
    ["src/app.ts", "/workspace/src/app.ts", null],
    ["src/app.ts:42", "/workspace/src/app.ts", 42],
    ["src/app.ts:42:3", "/workspace/src/app.ts", 42],
    ["package.json:12:3", "/workspace/package.json", 12],
    ["./scripts/run", "/workspace/scripts/run", null],
    ["scripts/run:7", "/workspace/scripts/run", 7],
    ["/workspace/scripts/run", "/workspace/scripts/run", null],
    ["./scripts/run:7:2", "/workspace/scripts/run", 7],
    ["Dockerfile:8", "/workspace/Dockerfile", 8],
    [".gitignore", "/workspace/.gitignore", null],
    ["/workspace/src/app.ts:9:2", "/workspace/src/app.ts", 9],
    ["C:\\repo\\src\\app.ts:12:3", "C:\\repo\\src\\app.ts", 12],
  ])(
    "opens inline-code file reference %s at its line",
    (reference, path, line) => {
      render(
        <MarkdownPreview
          content={`Read \`${reference}\`.`}
          linkRouting={workspaceLinkRouting}
        />,
      );

      const link = screen.getByRole("link", { name: reference });
      expect(link.getAttribute("href")).toBe(
        `${path.startsWith("C:") ? "file:///C:/repo/src/app.ts" : `file://${path}`}${line === null ? "" : `#L${line}`}`,
      );
      fireEvent.click(link);
      expect(
        workspaceLinkRouting.localFile.onOpenLink,
      ).toHaveBeenCalledExactlyOnceWith({
        path,
        lineRange:
          line === null ? null : { startLineNumber: line, endLineNumber: line },
        openTargetId: null,
      });
    },
  );

  it.each([
    "origin/main",
    "...[origin/main]",
    "feature/my-branch",
    "scripts/run",
    "orange",
    "npm.test()",
    "cat src/app.ts",
    "https://example.com/app.ts:42",
    "src/app.ts:0",
    "src/app.ts:9007199254740992",
    "../outside.ts:4",
    "src/app.ts?raw",
  ])("keeps non-file inline code %s literal", (reference) => {
    render(
      <MarkdownPreview
        content={`Read \`${reference}\`.`}
        linkRouting={workspaceLinkRouting}
      />,
    );

    expect(screen.queryByRole("link", { name: reference })).toBeNull();
    expect(screen.getByText(reference).tagName).toBe("CODE");
  });

  it("preserves inline commands ending in Markdown paths as code", () => {
    render(
      <MarkdownPreview
        content={
          "Added `orange` and ran `cat things.md`:\n\n```text\nasdf\napple\npear\norange\n```\n\n`cat /workspace/things.md` and `git diff docs/guide.markdown:4`. See [my notes](<notes/my notes.md>)."
        }
        linkRouting={workspaceLinkRouting}
      />,
    );

    for (const command of [
      "cat things.md",
      "cat /workspace/things.md",
      "git diff docs/guide.markdown:4",
    ]) {
      expect(screen.getByText(command).tagName).toBe("CODE");
      expect(screen.queryByRole("link", { name: command })).toBeNull();
    }
    expect(
      screen.getByRole("link", { name: "my notes" }).getAttribute("href"),
    ).toBe("file:///workspace/notes/my%20notes.md");
  });

  it("shows a context menu on local file links when the context provides items", () => {
    const openBuiltin = vi.fn();
    const openFinder = vi.fn();
    const openWithPlugin = vi.fn();
    render(
      <MarkdownLocalFileContextMenuContext.Provider
        value={(link) =>
          link.path.endsWith(".md")
            ? [
                {
                  id: "open-in",
                  items: [
                    {
                      id: "finder",
                      label: "Open in Finder",
                      onSelect: openFinder,
                    },
                  ],
                  label: "Open in",
                  type: "submenu",
                },
                {
                  id: "open-in-separator",
                  type: "separator",
                },
                {
                  id: "builtin",
                  label: "Open with built-in preview",
                  onSelect: openBuiltin,
                },
                {
                  id: "separator",
                  type: "separator",
                },
                {
                  id: "notes:editor",
                  label: "Open with Notes editor",
                  onSelect: openWithPlugin,
                },
              ]
            : null
        }
      >
        <MarkdownPreview
          content="See [notes](/workspace/notes/todo.md) and [app](/workspace/src/app.ts)."
          linkRouting={{
            localFile: {
              absoluteLinks: { kind: "trusted-host" },
              onOpenLink: vi.fn(() => true),
            },
          }}
        />
      </MarkdownLocalFileContextMenuContext.Provider>,
    );

    const link = screen.getByRole("link", { name: /notes/ });
    fireEvent.contextMenu(link);
    expect(screen.getByText("Open in")).not.toBeNull();
    fireEvent.click(screen.getByText("Open with Notes editor"));
    expect(openWithPlugin).toHaveBeenCalledTimes(1);
    expect(openFinder).not.toHaveBeenCalled();
    expect(openBuiltin).not.toHaveBeenCalled();

    fireEvent.contextMenu(screen.getByRole("link", { name: /app/ }));
    expect(screen.queryByText(/Open with/)).toBeNull();
  });

  it("leaves inline-code paths as code without local file routing", () => {
    render(
      <MarkdownPreview content="Read `README.md` and `src/app.ts:42:3`." />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("README.md").tagName).toBe("CODE");
    expect(screen.getByText("src/app.ts:42:3").tagName).toBe("CODE");
  });

  it("keeps file references inside fenced code literal", () => {
    const { container } = render(
      <MarkdownPreview
        content={"```text\nsrc/app.ts:42:3\n```"}
        linkRouting={workspaceLinkRouting}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(requireElement(container, "pre code").textContent).toBe(
      "src/app.ts:42:3",
    );
  });

  it("renders sanitized HTML video and source URLs through local file routing", () => {
    const { container } = render(
      <MarkdownPreview
        allowHtml
        content={
          '<video controls poster="poster.png" title="Demo"><source src="clips/demo.mp4" type="video/mp4"></video>\n\n![image](still.mp4)\n\n[download](clips/demo.mp4)'
        }
        linkRouting={{
          localImage: {
            absolutePaths: { kind: "trusted-host" },
            relativePaths: { baseDir: "/workspace", rootPath: "/workspace" },
            resolveSrc: ({ path }) =>
              `/content?path=${encodeURIComponent(path)}`,
          },
        }}
      />,
    );
    const video = container.querySelector("video");
    expect(video?.getAttribute("poster")).toBe(
      "/content?path=%2Fworkspace%2Fposter.png",
    );
    expect(video?.querySelector("source")?.getAttribute("src")).toBe(
      "/content?path=%2Fworkspace%2Fclips%2Fdemo.mp4",
    );
    expect(video?.querySelector("source")?.type).toBe("video/mp4");
    expect(video?.controls).toBe(true);
    expect(video?.playsInline).toBe(true);
    expect(video?.preload).toBe("metadata");
    expect(video?.getAttribute("aria-label")).toBe("Demo");
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "download" })).not.toBeNull();
  });

  it("strips unsafe video attributes, URLs, and executable HTML", () => {
    const { container } = render(
      <MarkdownPreview
        allowHtml
        content={
          '<video src="javascript:alert(1)" poster="javascript:alert(1)" onerror="alert(1)" autoplay style="position:fixed"><source src="javascript:alert(1)"></video><script>alert(1)</script><iframe src="https://example.com"></iframe>'
        }
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    for (const attribute of ["src", "poster", "onerror", "autoplay", "style"]) {
      expect(video?.hasAttribute(attribute)).toBe(false);
    }
    expect(video?.querySelector("source")?.hasAttribute("src")).toBe(false);
    expect(container.querySelector("script, iframe")).toBeNull();
  });

  it("preserves a video element as streaming Markdown grows", () => {
    const content =
      '<video src="https://example.com/clip.mp4" controls></video>\n\n';
    const { container, rerender } = render(
      <MarkdownPreview
        allowHtml
        incrementalBlocks
        content={content + "First"}
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    rerender(
      <MarkdownPreview
        allowHtml
        incrementalBlocks
        content={content + "First paragraph grows"}
      />,
    );
    expect(container.querySelector("video")).toBe(video);
  });

  it("keeps video HTML disabled when not opted in and suppresses media in text-only previews", () => {
    const content =
      '<video src="https://example.com/clip.mp4" title="Demo"></video>';
    const { container, rerender } = render(
      <MarkdownPreview content={content} />,
    );
    expect(container.querySelector("video")).toBeNull();
    rerender(
      <MarkdownPreview allowHtml content={content} imagePolicy="alt-text" />,
    );
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText("[Video: Demo]")).not.toBeNull();
  });

  it("routes local Markdown images through the configured content resolver", () => {
    const resolveSrc = vi.fn(
      ({ path }: { path: string }) =>
        `/api/files/content?path=${encodeURIComponent(path)}`,
    );
    const { container } = render(
      <MarkdownPreview
        content={[
          "![absolute](/workspace/generated.png)",
          "![relative](art/chart.png)",
          "![remote](https://example.com/image.png)",
        ].join("\n\n")}
        linkRouting={{
          localImage: {
            absolutePaths: { kind: "trusted-host" },
            relativePaths: {
              baseDir: "/workspace",
              rootPath: "/workspace",
            },
            resolveSrc,
          },
        }}
      />,
    );

    expect(
      container.querySelector('img[alt="absolute"]')?.getAttribute("src"),
    ).toBe("/api/files/content?path=%2Fworkspace%2Fgenerated.png");
    expect(
      container.querySelector('img[alt="relative"]')?.getAttribute("src"),
    ).toBe("/api/files/content?path=%2Fworkspace%2Fart%2Fchart.png");
    expect(
      container.querySelector('img[alt="remote"]')?.getAttribute("src"),
    ).toBe("https://example.com/image.png");
    expect(resolveSrc).toHaveBeenCalledTimes(2);
  });

  it("keeps absolute app-origin URLs on the app-route path", () => {
    const onOpenLink = vi.fn(() => true);
    const href = `${window.location.origin}/threads/thr_localhost`;

    render(
      <MarkdownPreview
        content={`Open [local thread](${href}).`}
        linkRouting={{ onOpenLink }}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "local thread" }));

    expect(onOpenLink).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "local thread" }).getAttribute("href"),
    ).toBe(href);
  });

  it("routes editor file links to the local file handler with their editor", () => {
    const onOpenLink = vi.fn(() => true);
    const onOpenLocalFileLink = vi.fn(() => true);

    render(
      <MarkdownPreview
        content="Open [review](devin://file/Users/me/.bb/artifacts/thr_1/review.diff) or [cursor](Cursor://file/workspace/My%20App.ts:12:3)."
        linkRouting={{
          localFile: {
            absoluteLinks: { kind: "trusted-host" },
            onOpenLink: onOpenLocalFileLink,
          },
          onOpenLink,
        }}
      />,
    );

    const review = screen.getByRole("link", { name: "review" });
    expect(review.getAttribute("href")).toBe(
      "file:///Users/me/.bb/artifacts/thr_1/review.diff",
    );
    fireEvent.click(review);
    fireEvent.click(screen.getByRole("link", { name: "cursor" }));

    expect(onOpenLocalFileLink.mock.calls).toEqual([
      [
        {
          lineRange: null,
          openTargetId: "devin-desktop",
          path: "/Users/me/.bb/artifacts/thr_1/review.diff",
        },
      ],
      [
        {
          lineRange: { endLineNumber: 12, startLineNumber: 12 },
          openTargetId: "cursor",
          path: "/workspace/My App.ts",
        },
      ],
    ]);
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("shows the editor logo only on links whose editor can open them", () => {
    const { container } = render(
      <MarkdownLocalFileOpenTargetsContext.Provider
        value={[
          {
            capabilities: {
              openDirectory: true,
              openFile: true,
              openFileAtLine: true,
            },
            icon: { kind: "builtin", name: "devin-desktop" },
            id: "devin-desktop",
            label: "Devin Desktop",
          },
        ]}
      >
        <MarkdownPreview
          content="[review](devin://file/tmp/review.diff:3) [app](vscode://file/tmp/app.ts) [plain](/tmp/notes.md)"
          linkRouting={{
            localFile: {
              absoluteLinks: { kind: "trusted-host" },
              onOpenLink: () => true,
            },
          }}
        />
      </MarkdownLocalFileOpenTargetsContext.Provider>,
    );

    const review = screen.getByRole("link", { name: "review" });
    expect(review.getAttribute("title")).toBe("Open in Devin Desktop");
    expect(review.querySelector("img")).not.toBeNull();
    for (const name of ["app", "plain"]) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("title")).toBeNull();
      expect(link.querySelector("img")).toBeNull();
      expect(link.querySelector("svg")).not.toBeNull();
    }
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("keeps editor file links through the sanitized HTML path", () => {
    const onOpenLocalFileLink = vi.fn(() => true);

    const { container } = render(
      <MarkdownPreview
        allowHtml
        content={
          'Press <kbd>Enter</kbd> for [review](devin://file/tmp/review.diff) or <a href="vscode://file/tmp/a.ts">code</a>, not <a href="javascript:alert(1)">script</a> or <a href="devin://chat-plugin/install?source=https://example.invalid/plugin">install</a>.'
        }
        linkRouting={{
          localFile: {
            absoluteLinks: { kind: "trusted-host" },
            onOpenLink: onOpenLocalFileLink,
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "review" }));
    fireEvent.click(screen.getByRole("link", { name: "code" }));

    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(onOpenLocalFileLink.mock.calls).toEqual([
      [
        {
          lineRange: null,
          openTargetId: "devin-desktop",
          path: "/tmp/review.diff",
        },
      ],
      [{ lineRange: null, openTargetId: "vscode", path: "/tmp/a.ts" }],
    ]);
  });

  it("renders links with blocked protocols as inert text", () => {
    const onOpenLink = vi.fn(() => true);
    const onOpenLocalFileLink = vi.fn(() => true);

    const { container } = render(
      <MarkdownPreview
        content={
          "[script](javascript:alert(1)) [data](data:text/html,hi) [unknown](ms-msdt:/id) [install](devin://chat-plugin/install?source=https://example.invalid/plugin) [command](vscode://command/workbench.action.terminal.new) [query](vscode://file/tmp/a.ts?windowId=_blank) [empty]()"
        }
        linkRouting={{
          localFile: {
            absoluteLinks: { kind: "trusted-host" },
            onOpenLink: onOpenLocalFileLink,
          },
          onOpenLink,
        }}
      />,
    );

    expect(container.querySelectorAll("a")).toHaveLength(0);
    for (const name of [
      "script",
      "data",
      "unknown",
      "install",
      "command",
      "query",
      "empty",
    ]) {
      fireEvent.click(screen.getByText(name));
    }
    expect(onOpenLink).not.toHaveBeenCalled();
    expect(onOpenLocalFileLink).not.toHaveBeenCalled();
  });

  it("rewrites localhost link hrefs without changing the visible text", () => {
    const displayedText = "http://127.0.0.1:5173";

    render(
      <MarkdownPreview
        content={`Open [${displayedText}](http://127.0.0.1:5173/demo).`}
      />,
    );

    const link = screen.getByRole("link", { name: displayedText });
    expect(link.getAttribute("href")).toBe(
      `${window.location.protocol}//${window.location.hostname}:5173/demo`,
    );
  });

  it("keeps a rewritten link mounted across unrelated preview rerenders", () => {
    const content = "Open [preview](http://localhost:5173/demo).";
    const { rerender } = render(
      <MarkdownPreview className="first" content={content} />,
    );
    const link = screen.getByRole("link", { name: "preview" });

    rerender(<MarkdownPreview className="second" content={content} />);

    expect(screen.getByRole("link", { name: "preview" })).toBe(link);
  });

  it.each([false, true])(
    "keeps links and inline code mounted when link routing and thread mentions change identity (incrementalBlocks=%s)",
    (incrementalBlocks) => {
      const content =
        "See [docs](https://example.com/docs) and `inline_code` here.";
      const routing = (): MarkdownLinkRouting => ({
        onOpenLink: () => true,
        localImage: {
          absolutePaths: { kind: "trusted-host" },
          resolveSrc: ({ path }) => `/files${path}`,
        },
      });
      const { container, rerender } = render(
        <MarkdownPreview
          content={content}
          incrementalBlocks={incrementalBlocks}
          linkRouting={routing()}
          threadMentions={{ mentions: [], preserveSoftBreaks: false }}
        />,
      );
      const link = screen.getByRole("link", { name: "docs" });
      const code = container.querySelector("code");

      rerender(
        <MarkdownPreview
          content={content}
          incrementalBlocks={incrementalBlocks}
          linkRouting={routing()}
          threadMentions={{ mentions: [], preserveSoftBreaks: false }}
        />,
      );

      expect(screen.getByRole("link", { name: "docs" })).toBe(link);
      expect(container.querySelector("code")).toBe(code);
    },
  );

  it("routes a link through the latest handler after routing changes", () => {
    const content = "See [docs](https://example.com/docs).";
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const { rerender } = render(
      <MarkdownPreview content={content} linkRouting={{ onOpenLink: first }} />,
    );

    rerender(
      <MarkdownPreview
        content={content}
        linkRouting={{ onOpenLink: second }}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "docs" }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("renders inline LaTeX math with KaTeX", async () => {
    const { container } = render(
      <MarkdownPreview content={"Mass-energy is $$E = mc^2$$ exactly."} />,
    );

    await waitFor(() =>
      expect(container.querySelector(".katex")).not.toBeNull(),
    );
    expect(container.querySelector(".katex-display")).toBeNull();
  });

  it("renders single-dollar inline math with KaTeX", async () => {
    const { container } = render(
      <MarkdownPreview content={"Energy is $E = mc^2$ and $x$, not $$y$$."} />,
    );

    await waitFor(() =>
      expect(container.querySelectorAll(".katex")).toHaveLength(3),
    );
    expect(container.querySelector(".katex-display")).toBeNull();
  });

  it.each([
    ["Half is $1/2$ here.", "1/2"],
    ["Grows as $2^n$ steps.", "2^n"],
    ["Rate $0.5x$ overall.", "0.5x"],
    ["Exactly $0.25$ of it.", "0.25"],
  ])("renders digit-led math in %j", async (content, tex) => {
    const { container } = render(<MarkdownPreview content={content} />);

    await waitFor(() =>
      expect(container.querySelectorAll(".katex")).toHaveLength(1),
    );
    expect(container.querySelector("annotation")?.textContent).toBe(tex);
  });

  it("keeps a dollar amount literal beside single-dollar math", async () => {
    const { container } = render(
      <MarkdownPreview content={"It costs $5 and $\\alpha$ more."} />,
    );

    await waitFor(() =>
      expect(container.querySelectorAll(".katex")).toHaveLength(1),
    );
    expect(container.textContent).toContain("It costs $5 and ");
  });

  it.each([false, true])(
    "preserves code spans after currency with incrementalBlocks=%s",
    (incrementalBlocks) => {
      const content = [
        'so chat text like "$5 to $10" was showing up as math (issue #511).',
        "PR #512 fixed that by disabling single-`$` math (`singleDollarTextMath: false` in `markdown-preview.tsx`).",
        "As a result, `$x$` shows as raw TeX everywhere: in chat and in opened `.md` files, since both use the same `MarkdownPreview`. Only `$$…$$` renders.",
      ].join(" ");
      const { container } = render(
        <MarkdownPreview
          content={content}
          incrementalBlocks={incrementalBlocks}
        />,
      );

      expect(
        Array.from(
          container.querySelectorAll("code"),
          (node) => node.textContent,
        ),
      ).toEqual([
        "$",
        "singleDollarTextMath: false",
        "markdown-preview.tsx",
        "$x$",
        ".md",
        "MarkdownPreview",
        "$$…$$",
      ]);
      expect(container.textContent).toBe(content.replaceAll("`", ""));
      expect(container.querySelector(".katex, .katex-error")).toBeNull();
    },
  );

  it.each([
    ["Pay $5 for `$x$`, then $y$.", "$x$"],
    ["Pay $5 for ``a `$x$` sample``, then $y$.", "a `$x$` sample"],
    ["Pay $5 for\n`$x$`, then $y$.", "$x$"],
  ])("keeps code and math separate in %j", async (content, code) => {
    const { container } = render(<MarkdownPreview content={content} />);

    await waitFor(() =>
      expect(container.querySelectorAll(".katex")).toHaveLength(1),
    );
    expect(container.querySelector("code")?.textContent).toBe(code);
    expect(container.querySelector("annotation")?.textContent).toBe("y");
    expect(container.textContent).toContain("Pay $5 for");
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it.each([
    ["It went from $5 to $10 last week.", "$5 to $10"],
    ["Pay $5, then $10.", "$5, then $10"],
    ["Between $20,000 and $30,000 a year.", "$20,000 and $30,000"],
    ["A $5/$10 split.", "$5/$10"],
    [
      "About $0.04 of calls, at 327,000 of 500,000 µ$ today.",
      "$0.04 of calls, at 327,000 of 500,000 µ$ today",
    ],
    ["Costs $5; limit is 10 µ$ today.", "$5; limit is 10 µ$"],
    ["Up to $1,200.50! Then x$ more.", "$1,200.50! Then x$"],
    ["Spaced $ x $ stays literal.", "$ x $"],
    ["Inline `$x$` code stays literal.", "$x$"],
  ])("leaves %j as literal text", (content, literal) => {
    const { container } = render(<MarkdownPreview content={content} />);

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain(literal);
  });

  it("leaves escaped dollar amounts as literal text", () => {
    const { container } = render(
      <MarkdownPreview content={"It went from \\$5 to \\$10 last week."} />,
    );

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$5");
    expect(container.textContent).toContain("$10");
  });

  it("renders math while still sanitizing untrusted HTML when allowHtml is set", async () => {
    const { container } = render(
      <MarkdownPreview
        allowHtml
        content={"$$a^2 + b^2 = c^2$$\n\n<script>alert(1)</script>"}
      />,
    );

    await waitFor(() =>
      expect(container.querySelector(".katex")).not.toBeNull(),
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("alert(1)");
  });

  it("contains invalid TeX instead of throwing", async () => {
    const { container } = render(
      <MarkdownPreview content={"Broken: $$\\frac{1}{$$ keeps rendering."} />,
    );

    await waitFor(() =>
      expect(container.querySelector(".katex-error")).not.toBeNull(),
    );
    expect(container.textContent).toContain("keeps rendering.");
  });

  it("closes a display math block whose `$$` delimiters are glued to the TeX (#1778)", async () => {
    const { container } = render(
      <MarkdownPreview
        content={[
          "Before the formula.",
          "",
          "$$T_{\\text{appearance}\\rightarrow\\text{chunk}}",
          "\\approx73\\text{--}146\\text{ ms}$$",
          "",
          "## Content after the formula",
          "",
          "- This should remain a list item.",
          "- [This should remain a link](https://example.com).",
        ].join("\n")}
      />,
    );

    await waitFor(() =>
      expect(container.querySelector(".katex-display")).not.toBeNull(),
    );
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(
      container.querySelector(".katex-display annotation")?.textContent,
    ).toContain("appearance");
    expect(container.querySelector("h2")?.textContent).toBe(
      "Content after the formula",
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(
      container.querySelector('a[href="https://example.com"]')?.textContent,
    ).toBe("This should remain a link");
  });
});

describe("application links", () => {
  it.each([false, true])(
    "keeps application links inert until enabled and responds to disabling (HTML: %s)",
    async (allowHtml) => {
      const openApplicationUrl = vi.fn(async () => {});
      vi.stubGlobal("bbDesktop", { openApplicationUrl });
      render(
        <MarkdownPreview
          allowHtml={allowHtml}
          content="[Review note](reflect://note/test) <kbd>Enter</kbd>"
        />,
      );
      expect(screen.queryByRole("link", { name: "Review note" })).toBeNull();
      fireEvent.click(screen.getByText("Review note"));
      expect(openApplicationUrl).not.toHaveBeenCalled();
      act(() => {
        appQueryClient.setQueryData(systemConfigQueryKey(), {
          experiments: { ...defaultExperiments, applicationLinks: true },
        });
      });
      fireEvent.click(await screen.findByRole("link", { name: "Review note" }));
      expect(openApplicationUrl).not.toHaveBeenCalled();
      resolveApplicationUrlConfirmation("open");
      await waitFor(() => expect(openApplicationUrl).toHaveBeenCalledOnce());
      act(() => {
        appQueryClient.setQueryData(systemConfigQueryKey(), {
          experiments: defaultExperiments,
        });
      });
      await waitFor(() =>
        expect(screen.queryByRole("link", { name: "Review note" })).toBeNull(),
      );
      fireEvent.click(screen.getByText("Review note"));
      expect(openApplicationUrl).toHaveBeenCalledOnce();
    },
  );

  it.each([false, true])(
    "preserves explicit links without launching during rendering (HTML: %s)",
    async (allowHtml) => {
      appQueryClient.setQueryData(systemConfigQueryKey(), {
        experiments: { ...defaultExperiments, applicationLinks: true },
      });
      const openApplicationUrl = vi.fn(async () => {});
      vi.stubGlobal("bbDesktop", { openApplicationUrl });
      const url = "reflect://note/Project%20X?tag=a%2Fb";
      render(
        <MarkdownPreview
          allowHtml={allowHtml}
          content={`[Review note](${url}) <kbd>Enter</kbd> [Linear](linear://issue/ABC-123) [Things](things:///show?id=123) ![image](linear://issue/image)`}
        />,
      );
      const link = await screen.findByRole("link", { name: "Review note" });
      expect(link.getAttribute("href")).toBe(url);
      expect(openApplicationUrl).not.toHaveBeenCalled();
      fireEvent.click(link);
      resolveApplicationUrlConfirmation("open");
      await waitFor(() => expect(openApplicationUrl).toHaveBeenCalledWith(url));
      fireEvent(
        screen.getByRole("link", { name: "Linear" }),
        new MouseEvent("auxclick", { bubbles: true, button: 1 }),
      );
      resolveApplicationUrlConfirmation("open");
      await waitFor(() =>
        expect(openApplicationUrl).toHaveBeenCalledWith(
          "linear://issue/ABC-123",
        ),
      );
      expect(document.querySelector('img[src^="linear:"]')).toBeNull();
    },
  );

  it("asks on every click in the browser and cancels without launching", async () => {
    appQueryClient.setQueryData(systemConfigQueryKey(), {
      experiments: { ...defaultExperiments, applicationLinks: true },
    });
    render(
      <>
        <MarkdownPreview content="[Review note](reflect://note/Project%20X)" />
        <ApplicationUrlDialog />
      </>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Review note" }));
    await screen.findByRole("dialog");
    expect(screen.getByText("reflect://note/Project%20X")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("link", { name: "Review note" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
});
