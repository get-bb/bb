// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ExperimentalFileOpenOptions } from "@get-bb/plugin-sdk";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { ThreadTimelineNavigationProvider } from "@/components/thread/timeline/ThreadTimelineNavigationContext";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";
import { resetDeprecatedAliasWarningsForTests } from "./plugin-sdk-deprecated-aliases";
import { AppNavigationHostProvider } from "./app-navigation-host";

const copyFilePath = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useResolvedLiveFileTarget", () => ({
  useResolvedLiveFileTarget: () => ({ status: "unavailable" }),
}));
vi.mock("@/hooks/useLocalOpenTargets", () => ({
  useLocalOpenTargets: () => ({
    isLoading: false,
    canOpenPreferredFileTarget: false,
    fileOpenTargets: [],
  }),
}));
vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({ fileOpeners: [] }),
}));
vi.mock("@/lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clipboard")>()),
  copyToClipboardWithToast: copyFilePath,
}));

afterEach(cleanup);

describe("plugin SDK deprecated aliases", () => {
  beforeEach(() => {
    resetDeprecatedAliasWarningsForTests();
  });

  it("hands experimental_UrlLink a stable alias that warns on its first render, not on access", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const runtime = pluginSdkAppImplementation;
      const alias = Reflect.get(runtime, "experimental_UrlLink");
      expect(typeof alias).toBe("function");
      expect(Reflect.get(runtime, "experimental_UrlLink")).toBe(alias);
      expect(warn).not.toHaveBeenCalled();
      expect(Object.keys(runtime)).not.toContain("experimental_UrlLink");

      const LegacyUrlLink = alias as typeof runtime.UrlLink;
      const view = render(
        <MemoryRouter>
          <AppNavigationHostProvider capabilities={{ openUrl: () => true }}>
            <PluginSlotMount pluginId="demo" slotKind="test" slotId="probe">
              <LegacyUrlLink href="https://example.com/docs">
                Docs
              </LegacyUrlLink>
            </PluginSlotMount>
          </AppNavigationHostProvider>
        </MemoryRouter>,
      );
      expect(screen.getByText("Docs").closest("a")?.getAttribute("href")).toBe(
        "https://example.com/docs",
      );
      view.rerender(
        <MemoryRouter>
          <AppNavigationHostProvider capabilities={{ openUrl: () => true }}>
            <PluginSlotMount pluginId="demo" slotKind="test" slotId="probe">
              <LegacyUrlLink href="https://example.com/docs">
                Docs again
              </LegacyUrlLink>
            </PluginSlotMount>
          </AppNavigationHostProvider>
        </MemoryRouter>,
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "experimental_UrlLink is deprecated; use UrlLink. Removed in bb 0.42",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("forwards navigate.experimental_openUrl to openUrl and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const openUrl = vi.fn(() => true);
    const results: unknown[] = [];
    function Probe() {
      const navigate = pluginSdkAppImplementation.useBbNavigate();
      const legacyOpenUrl = Reflect.get(navigate, "experimental_openUrl");
      return (
        <button
          type="button"
          onClick={() => {
            if (typeof legacyOpenUrl !== "function") {
              results.push("missing");
              return;
            }
            results.push(legacyOpenUrl("https://example.com/a"));
            results.push(legacyOpenUrl("https://example.com/b"));
          }}
        >
          Open
        </button>
      );
    }
    try {
      render(
        <MemoryRouter>
          <AppNavigationHostProvider capabilities={{ openUrl }}>
            <PluginSlotMount pluginId="demo" slotKind="test" slotId="probe">
              <Probe />
            </PluginSlotMount>
          </AppNavigationHostProvider>
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      expect(results).toEqual([true, true]);
      expect(openUrl).toHaveBeenNthCalledWith(1, {
        url: "https://example.com/a",
      });
      expect(openUrl).toHaveBeenNthCalledWith(2, {
        url: "https://example.com/b",
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "experimental_openUrl is deprecated; use openUrl. Removed in bb 0.42",
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe("plugin SDK Markdown", () => {
  it("uses the surrounding thread detail navigation for file and web links", () => {
    const onOpenLink = vi.fn(() => false);
    const openUrl = vi.fn(() => true);
    const onOpenLocalFileLink = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;

    render(
      <AppNavigationHostProvider capabilities={{ openUrl }}>
        <ThreadTimelineNavigationProvider
          environmentId={null}
          onOpenLink={onOpenLink}
          onOpenLocalFileLink={onOpenLocalFileLink}
          resolveMentionLink={() => null}
          workspaceRootPath="/workspace"
        >
          <Markdown content="Open [README](README.md) or [the docs](https://example.com/docs)." />
        </ThreadTimelineNavigationProvider>
      </AppNavigationHostProvider>,
    );

    const fileLink = screen.getByRole("link", { name: "README" });
    expect(fileLink.getAttribute("href")).toBe("file:///workspace/README.md");
    fireEvent.click(fileLink);
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: "/workspace/README.md",
    });

    fireEvent.click(screen.getByRole("link", { name: "the docs" }));
    expect(openUrl).toHaveBeenCalledWith({
      url: "https://example.com/docs",
    });
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("routes web links without requiring a thread navigation context", () => {
    const openUrl = vi.fn(() => true);
    const Markdown = pluginSdkAppImplementation.Markdown;
    render(
      <AppNavigationHostProvider capabilities={{ openUrl }}>
        <Markdown content="[Docs](https://example.com/docs)" />
      </AppNavigationHostProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Docs" }));
    expect(openUrl).toHaveBeenCalledWith({ url: "https://example.com/docs" });
  });
});

describe("plugin SDK navigation components", () => {
  it("exposes the file link through the real runtime", () => {
    const openFilePreview = vi.fn(() => true);
    const FileLink = pluginSdkAppImplementation.experimental_FileLink;
    render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <FileLink
          target={{
            kind: "thread-storage",
            threadId: "thr_1",
            path: "reports/result.md",
          }}
        >
          result.md
        </FileLink>
      </AppNavigationHostProvider>,
    );
    fireEvent.click(screen.getByRole("link", { name: "result.md" }));
    expect(openFilePreview).toHaveBeenCalledWith({
      target: {
        kind: "thread-storage",
        threadId: "thr_1",
        path: "reports/result.md",
      },
      location: null,
    });
  });
});

describe("plugin SDK Markdown policies at the real renderer", () => {
  const Markdown = pluginSdkAppImplementation.Markdown;
  const media = `![inline alt](https://beacon.invalid/inline.png)

![reference alt][beacon]

[beacon]: https://beacon.invalid/reference.png

<img src="https://beacon.invalid/html.png"><video src="https://beacon.invalid/video" poster="https://beacon.invalid/poster"><source src="https://beacon.invalid/source"></video><audio src="https://beacon.invalid/audio"></audio><iframe src="https://beacon.invalid/frame"></iframe><object data="https://beacon.invalid/object"></object>`;

  it("emits alt text without any fetchable media, and preserves default image rendering", () => {
    const view = render(
      <Markdown content={media} experimental_imagePolicy="alt-text" />,
    );
    expect(view.container.textContent).toContain("inline alt");
    expect(view.container.textContent).toContain("reference alt");
    expect(
      view.container.querySelector(
        "img,video,audio,source,iframe,object,embed,link,[src],[srcset],[poster]",
      ),
    ).toBeNull();
    view.rerender(<Markdown content={media} />);
    expect(
      screen.getByRole("img", { name: "inline alt" }).getAttribute("src"),
    ).toBe("https://beacon.invalid/inline.png");
    expect(
      screen.getByRole("img", { name: "reference alt" }).getAttribute("src"),
    ).toBe("https://beacon.invalid/reference.png");
    expect(
      view.container.querySelector("video,audio,source,iframe,object,embed"),
    ).toBeNull();
  });

  it("preserves host typography and URL routing without ambient timeline context", () => {
    const openUrl = vi.fn(() => true);
    const resolver = vi.fn(() => null);
    const urls = [
      "https://example.com/docs",
      "http://example.com/docs",
      "http://localhost:5173/report",
      "https://github.com/get-bb/bb/issues/135",
    ];
    const view = render(
      <AppNavigationHostProvider capabilities={{ openUrl }}>
        <Markdown
          experimental_imagePolicy="alt-text"
          experimental_resolveFileLink={resolver}
          content={`# Heading

| Name | Value |
| --- | --- |
| result | yes |

- First
- Second

\`inline code\`

\`\`\`text
block code
\`\`\`

${urls.map((url, i) => `[URL ${i}](${url})`).join(" ")}`}
        />
      </AppNavigationHostProvider>,
    );
    expect(screen.getByRole("heading", { name: "Heading" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(
      view.container.querySelectorAll("code").length,
    ).toBeGreaterThanOrEqual(2);
    for (const [i, url] of urls.entries()) {
      fireEvent.click(screen.getByRole("link", { name: `URL ${i}` }));
      expect(openUrl).toHaveBeenLastCalledWith({ url });
    }
    expect(resolver).not.toHaveBeenCalled();
  });

  it("exposes raw local anchors without a resolver: capture cannot secure context-menu or drag", () => {
    render(
      <Markdown content="[report](/Users/sender/report.md) [relative](reports/result.md)" />,
    );
    expect(
      screen.getByRole("link", { name: "report" }).getAttribute("href"),
    ).toBe("/Users/sender/report.md");
    expect(
      screen.getByRole("link", { name: "relative" }).getAttribute("href"),
    ).toBe("reports/result.md");
  });

  it("resolves raw destinations before normalization and never borrows ambient identity", () => {
    const openFilePreview = vi.fn(() => true);
    const ambient = vi.fn(() => true);
    const resolver = vi.fn((href: string) =>
      href === "/Users/sender/.bb/thread-storage/thr_foreign/report.md"
        ? {
            target: {
              kind: "host" as const,
              hostId: "host_sender",
              path: href,
            },
            location: { kind: "line" as const, line: 7, column: null },
          }
        : null,
    );
    const view = render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <ThreadTimelineNavigationProvider
          environmentId="env_wrong"
          onOpenLink={() => false}
          onOpenLocalFileLink={ambient}
          resolveMentionLink={() => null}
          workspaceRootPath="/wrong"
        >
          <Markdown
            experimental_resolveFileLink={resolver}
            content="[foreign report](/Users/sender/.bb/thread-storage/thr_foreign/report.md) [traversal](../secret.md) [encoded](%2e%2e/secret.md) [double](%252e%252e/secret.md) [file](file:///tmp/report.md) [missing](missing.md)"
          />
        </ThreadTimelineNavigationProvider>
      </AppNavigationHostProvider>,
    );
    expect(resolver.mock.calls.map(([href]) => href)).toEqual([
      "/Users/sender/.bb/thread-storage/thr_foreign/report.md",
      "../secret.md",
      "%2e%2e/secret.md",
      "%252e%252e/secret.md",
      "file:///tmp/report.md",
      "missing.md",
    ]);
    expect(view.container.querySelector("a[href]")).toBeNull();
    expect(screen.queryByRole("link", { name: "missing" })).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "foreign report" }));
    expect(openFilePreview).toHaveBeenCalledWith({
      target: {
        kind: "host",
        hostId: "host_sender",
        path: "/Users/sender/.bb/thread-storage/thr_foreign/report.md",
      },
      location: { kind: "line", line: 7, column: null },
    });
    expect(ambient).not.toHaveBeenCalled();
    view.rerender(
      <Markdown
        experimental_resolveFileLink={() => ({
          target: { kind: "host", hostId: "", path: "/tmp/report.md" },
          location: null,
        })}
        content="[invalid](report.md)"
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("invalid").tagName).toBe("SPAN");
  });
});

describe("resolved Markdown native file activation", () => {
  const Markdown = pluginSdkAppImplementation.Markdown;
  const intents: ExperimentalFileOpenOptions[] = [
    {
      target: {
        kind: "host",
        hostId: "host_sender",
        path: "/Users/sender/.bb/thread-storage/thr_foreign/report.md",
      },
      location: { kind: "line", line: 9, column: 2 },
    },
    {
      target: {
        kind: "workspace",
        environmentId: "env_sender",
        path: "images/result.png",
      },
      location: null,
    },
    {
      target: {
        kind: "thread-storage",
        threadId: "thr_sender",
        path: "result.md",
      },
      location: null,
    },
  ];

  it.each(intents)(
    "preserves $target.kind identity and gates browser activation",
    async (intent) => {
      const openFilePreview = vi.fn(() => true);
      const view = render(
        <AppNavigationHostProvider capabilities={{ openFilePreview }}>
          <Markdown
            content="[result](result.md)"
            experimental_resolveFileLink={() => intent}
          />
        </AppNavigationHostProvider>,
      );
      const link = screen.getByRole("link", { name: "result" });
      expect(link.getAttribute("href")).toBeNull();
      expect(link.tabIndex).toBe(0);
      for (const modifier of ["metaKey", "ctrlKey", "altKey", "shiftKey"]) {
        expect(fireEvent.click(link, { [modifier]: true })).toBe(false);
      }
      expect(
        fireEvent(
          link,
          new MouseEvent("auxclick", {
            button: 1,
            bubbles: true,
            cancelable: true,
          }),
        ),
      ).toBe(false);
      expect(openFilePreview).not.toHaveBeenCalled();
      fireEvent.dragStart(link);
      expect(view.container.querySelector("a[href]")).toBeNull();
      expect(fireEvent.click(link)).toBe(false);
      expect(openFilePreview).toHaveBeenLastCalledWith(intent);
      fireEvent.keyDown(link, { key: "Enter" });
      expect(openFilePreview).toHaveBeenCalledTimes(2);
      expect(openFilePreview).toHaveBeenLastCalledWith(intent);
      expect(fireEvent.contextMenu(link)).toBe(false);
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Copy file path" }),
      );
      expect(copyFilePath).toHaveBeenLastCalledWith(
        intent.target.path,
        expect.any(Object),
      );
      fireEvent.contextMenu(link);
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Open preview" }),
      );
      expect(openFilePreview).toHaveBeenLastCalledWith(intent);
    },
  );

  it("keeps throwing, malformed, traversal, and rejected resolutions inert without ambient fallback", () => {
    const openFilePreview = vi.fn(() => true);
    const content = "[result](result.md)";
    const view = render(
      <AppNavigationHostProvider capabilities={{ openFilePreview }}>
        <Markdown
          content={content}
          experimental_resolveFileLink={() => {
            throw new Error("unavailable context");
          }}
        />
      </AppNavigationHostProvider>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    for (const path of [
      "../secret",
      "/tmp/../secret",
      String.fromCharCode(0xd800),
    ]) {
      view.rerender(
        <Markdown
          content={content}
          experimental_resolveFileLink={() => ({
            target: { kind: "host", hostId: "host_sender", path },
            location: null,
          })}
        />,
      );
      expect(screen.queryByRole("link")).toBeNull();
      expect(view.container.querySelector("[href]")).toBeNull();
    }
    expect(openFilePreview).not.toHaveBeenCalled();
  });
});
