// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { UrlTransform } from "react-markdown";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { AppRouteNavigationProvider } from "@/components/ui/app-route-anchor";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import type {
  MarkdownAbsoluteLocalFileLinkRouting,
  MarkdownPreviewLocalFileLinkHandler,
  MarkdownRelativeLocalFileLinkRouting,
} from "@/components/ui/markdown-local-file-link";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import {
  restoreMatchMedia,
  setupMatchMedia,
} from "@/test/helpers/match-media.js";
import { setPreferredTheme } from "@/hooks/useTheme";

type ClipboardWriteText = (text: string) => Promise<void>;

interface BuildMarkdownLinkRoutingArgs {
  absoluteLinks?: MarkdownAbsoluteLocalFileLinkRouting;
  onOpenLink?: MarkdownPreviewLinkHandler;
  onOpenLocalFileLink?: MarkdownPreviewLocalFileLinkHandler;
  relativeLinks?: MarkdownRelativeLocalFileLinkRouting;
}

interface LocationProbeProps {
  label: string;
}

function buildMarkdownLinkRouting({
  absoluteLinks,
  onOpenLink,
  onOpenLocalFileLink,
  relativeLinks,
}: BuildMarkdownLinkRoutingArgs): MarkdownLinkRouting {
  const routing: MarkdownLinkRouting = {};
  if (onOpenLink) {
    routing.onOpenLink = onOpenLink;
  }
  if (onOpenLocalFileLink) {
    routing.localFile = {
      absoluteLinks:
        absoluteLinks ??
        (relativeLinks
          ? {
              kind: "contained",
              rootPath: relativeLinks.rootPath,
            }
          : {
              kind: "trusted-host",
            }),
      onOpenLink: onOpenLocalFileLink,
    };
    if (relativeLinks !== undefined) {
      routing.localFile.relativeLinks = relativeLinks;
    }
  }
  return routing;
}

function LocationProbe({ label }: LocationProbeProps) {
  const location = useLocation();
  return (
    <span data-testid={label}>
      {location.pathname}
      {location.search}
      {location.hash}
    </span>
  );
}

function installClipboardWriteTextMock() {
  const writeText = vi.fn<ClipboardWriteText>();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

afterEach(() => {
  cleanup();
  setPreferredTheme("system");
  document.documentElement.classList.remove("dark");
  restoreMatchMedia();
  vi.clearAllMocks();
});

describe("MarkdownPreview", () => {
  it("does not render raw HTML by default", () => {
    const { container } = render(
      <MarkdownPreview content="<span>Inline HTML</span>" />,
    );

    expect(container.querySelector("span")).toBeNull();
  });

  it("renders sanitized raw HTML when explicitly allowed", () => {
    const { container } = render(
      <MarkdownPreview
        allowHtml
        content={[
          "Line one<br />line two",
          '<details open><summary>More</summary><div onmouseover="alert(1)">Body</div></details>',
          "<script>alert(1)</script>",
        ].join("\n")}
      />,
    );

    expect(screen.getByText("More")).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.getByText("Body").getAttribute("onmouseover")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByText("alert(1)")).toBeNull();
  });

  it("strips unsafe links, image handlers, and embedded HTML", () => {
    const { container } = render(
      <MarkdownPreview
        allowHtml
        content={[
          '<a href="javascript:alert(1)">Unsafe link</a>',
          '<img alt="Unsafe image" src="https://example.test/image.png" onerror="alert(1)" />',
          '<iframe src="https://example.test/embed"></iframe>',
          "<style>body { display: none; }</style>",
        ].join("\n")}
      />,
    );

    const link = screen.getByText("Unsafe link").closest("a");
    const image = screen.getByRole("img", { name: "Unsafe image" });

    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBeNull();
    expect(image.getAttribute("src")).toBe("https://example.test/image.png");
    expect(image.getAttribute("onerror")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
  });

  it("resolves raw HTML picture sources and preserves layout attributes", () => {
    setupMatchMedia();
    setPreferredTheme("dark");

    const { container } = render(
      <MarkdownPreview
        allowHtml
        content={[
          '<p align="center">',
          "<picture>",
          '  <source media="(prefers-color-scheme: dark)" srcset="https://example.test/dark.png">',
          '  <source media="(prefers-color-scheme: light)" srcset="https://example.test/light.png">',
          '  <img alt="bb" src="https://example.test/light.png" width="128">',
          "</picture>",
          "</p>",
        ].join("\n")}
      />,
    );

    const image = screen.getByRole("img", { name: "bb" });
    const paragraph = image.closest("p");
    const sourceElements = Array.from(container.querySelectorAll("source"));
    const darkSource = sourceElements.find(
      (sourceElement) =>
        sourceElement.getAttribute("srcset") ===
        "https://example.test/dark.png",
    );
    const lightSource = sourceElements.find(
      (sourceElement) =>
        sourceElement.getAttribute("srcset") ===
        "https://example.test/light.png",
    );

    expect(paragraph?.getAttribute("align")).toBe("center");
    expect(image.getAttribute("width")).toBe("128");
    expect(darkSource?.getAttribute("media")).toBe("all");
    expect(lightSource?.getAttribute("media")).toBe("not all");
  });

  it("routes local file link clicks through the handler and prevents default navigation", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Open absolute](/workspace/src/app.ts:12)"
        linkRouting={buildMarkdownLinkRouting({ onOpenLocalFileLink })}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Open absolute" }));

    expect(onOpenLocalFileLink).toHaveBeenCalledTimes(1);
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: { startLineNumber: 12, endLineNumber: 12 },
      path: "/workspace/src/app.ts",
    });
  });

  it("routes local file link ranges through the handler", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Open range](/workspace/src/app.ts#L12-L15)"
        linkRouting={buildMarkdownLinkRouting({ onOpenLocalFileLink })}
      />,
    );

    const link = screen.getByRole("link", { name: "Open range" });
    expect(link.getAttribute("href")).toBe(
      "file:///workspace/src/app.ts#L12-L15",
    );

    fireEvent.click(link);

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: { startLineNumber: 12, endLineNumber: 15 },
      path: "/workspace/src/app.ts",
    });
  });

  it("contains absolute local file links before routing preview markdown", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content={[
          "[Allowed](file:///workspace/src/app.ts#L4)",
          "[Plain secret](/etc/shadow)",
          "[File secret](file:///etc/shadow)",
        ].join("\n\n")}
        linkRouting={buildMarkdownLinkRouting({
          absoluteLinks: {
            kind: "contained",
            rootPath: "/workspace",
          },
          onOpenLocalFileLink,
        })}
      />,
    );

    const allowedLink = screen.getByRole("link", { name: "Allowed" });
    expect(allowedLink.getAttribute("href")).toBe(
      "file:///workspace/src/app.ts#L4",
    );

    fireEvent.click(allowedLink);
    fireEvent.click(screen.getByRole("link", { name: "Plain secret" }));
    fireEvent.click(screen.getByText("File secret"));

    expect(onOpenLocalFileLink).toHaveBeenCalledTimes(1);
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: { startLineNumber: 4, endLineNumber: 4 },
      path: "/workspace/src/app.ts",
    });
  });

  it("renders absolute local file links with literal spaces in the markdown destination", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    const linkName = "Candidate Changelog \u2014 Since 0.9.1";
    const markdown = [
      `[${linkName}](`,
      "/Users/brsbl/Moss/Notes/Agent Workspaces/bb Workspace/workstreams/",
      "moss-skills-distribution-discovery/",
      "Candidate%20Changelog%20%E2%80%94%20Since%200.9.1/",
      "Candidate%20Changelog%20%E2%80%94%20Since%200.9.1.md)",
    ].join("");

    render(
      <MarkdownPreview
        content={markdown}
        linkRouting={buildMarkdownLinkRouting({ onOpenLocalFileLink })}
      />,
    );

    const link = screen.getByRole("link", { name: linkName });
    expect(link.getAttribute("href")).toBe(
      [
        "file:///Users/brsbl/Moss/Notes/Agent%20Workspaces/",
        "bb%20Workspace/workstreams/moss-skills-distribution-discovery/",
        "Candidate%20Changelog%20%E2%80%94%20Since%200.9.1/",
        "Candidate%20Changelog%20%E2%80%94%20Since%200.9.1.md",
      ].join(""),
    );

    fireEvent.click(link);

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: [
        "/Users/brsbl/Moss/Notes/Agent Workspaces/bb Workspace/workstreams/",
        "moss-skills-distribution-discovery/",
        "Candidate Changelog \u2014 Since 0.9.1/",
        "Candidate Changelog \u2014 Since 0.9.1.md",
      ].join(""),
    });
  });

  it("preserves link titles when rendering local file links with literal spaces", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content={'[Notes](/Users/me/My Notes/app.md "My doc")'}
        linkRouting={buildMarkdownLinkRouting({ onOpenLocalFileLink })}
      />,
    );

    const link = screen.getByRole("link", { name: "Notes" });
    expect(link.getAttribute("href")).toBe(
      "file:///Users/me/My%20Notes/app.md",
    );
    expect(link.getAttribute("title")).toBe("My doc");

    fireEvent.click(link);

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: "/Users/me/My Notes/app.md",
    });
  });

  it("omits unsupported section fragments from rendered local file hrefs", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Notes](/Users/me/My Notes/app.md#section)"
        linkRouting={buildMarkdownLinkRouting({ onOpenLocalFileLink })}
      />,
    );

    const link = screen.getByRole("link", { name: "Notes" });
    expect(link.getAttribute("href")).toBe(
      "file:///Users/me/My%20Notes/app.md",
    );

    fireEvent.click(link);

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: "/Users/me/My Notes/app.md",
    });
  });

  it("resolves relative links against the base dir as local file links", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Summary](current/branch-summary.md#L7)"
        linkRouting={buildMarkdownLinkRouting({
          onOpenLocalFileLink,
          relativeLinks: {
            baseDir: "/storage/thr_1",
            rootPath: "/storage/thr_1",
          },
        })}
      />,
    );

    const link = screen.getByRole("link", { name: "Summary" });
    expect(link.getAttribute("href")).toBe(
      "file:///storage/thr_1/current/branch-summary.md#L7",
    );

    fireEvent.click(link);

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: { startLineNumber: 7, endLineNumber: 7 },
      path: "/storage/thr_1/current/branch-summary.md",
    });
  });

  it("resolves relative links from a root base dir", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Intro](intro.md)"
        linkRouting={buildMarkdownLinkRouting({
          onOpenLocalFileLink,
          relativeLinks: {
            baseDir: "/",
            rootPath: "/",
          },
        })}
      />,
    );

    const link = screen.getByRole("link", { name: "Intro" });
    expect(link.getAttribute("href")).toBe("file:///intro.md");

    fireEvent.click(link);

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: "/intro.md",
    });
  });

  it("routes relative filename line suffix links inside the allowed root", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content={[
          "[Lockfile](Cargo.lock:14:33)",
          "[Markdown](foo.md:5)",
          "[Extensionless](foo:5)",
        ].join("\n\n")}
        linkRouting={buildMarkdownLinkRouting({
          onOpenLocalFileLink,
          relativeLinks: {
            baseDir: "/workspace",
            rootPath: "/workspace",
          },
        })}
      />,
    );

    const lockfileLink = screen.getByRole("link", { name: "Lockfile" });
    const markdownLink = screen.getByRole("link", { name: "Markdown" });
    const extensionlessLink = screen.getByRole("link", {
      name: "Extensionless",
    });
    expect(lockfileLink.getAttribute("href")).toBe(
      "file:///workspace/Cargo.lock#L14",
    );
    expect(markdownLink.getAttribute("href")).toBe(
      "file:///workspace/foo.md#L5",
    );
    expect(extensionlessLink.getAttribute("href")).toBe(
      "file:///workspace/foo#L5",
    );

    fireEvent.click(lockfileLink);
    fireEvent.click(markdownLink);
    fireEvent.click(extensionlessLink);

    expect(onOpenLocalFileLink).toHaveBeenCalledTimes(3);
    expect(onOpenLocalFileLink).toHaveBeenNthCalledWith(1, {
      lineRange: { startLineNumber: 14, endLineNumber: 14 },
      path: "/workspace/Cargo.lock",
    });
    expect(onOpenLocalFileLink).toHaveBeenNthCalledWith(2, {
      lineRange: { startLineNumber: 5, endLineNumber: 5 },
      path: "/workspace/foo.md",
    });
    expect(onOpenLocalFileLink).toHaveBeenNthCalledWith(3, {
      lineRange: { startLineNumber: 5, endLineNumber: 5 },
      path: "/workspace/foo",
    });
  });

  it("normalizes parent-relative links that stay inside the allowed root", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Status](../status.md)"
        linkRouting={buildMarkdownLinkRouting({
          onOpenLocalFileLink,
          relativeLinks: {
            baseDir: "/storage/thr_1/current",
            rootPath: "/storage/thr_1",
          },
        })}
      />,
    );

    const link = screen.getByRole("link", { name: "Status" });
    expect(link.getAttribute("href")).toBe("file:///storage/thr_1/status.md");

    fireEvent.click(link);

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: "/storage/thr_1/status.md",
    });
  });

  it("does not route preview-relative links that escape the allowed root", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Secret](../../../secret.md)"
        linkRouting={buildMarkdownLinkRouting({
          onOpenLocalFileLink,
          relativeLinks: {
            baseDir: "/storage/thr_1/current/docs",
            rootPath: "/storage/thr_1",
          },
        })}
      />,
    );

    const link = screen.getByRole("link", { name: "Secret" });
    expect(link.getAttribute("href")).toBe("../../../secret.md");

    fireEvent.click(link);

    expect(onOpenLocalFileLink).not.toHaveBeenCalled();
  });

  it("leaves relative links untouched without a base dir", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Summary](current/branch-summary.md)"
        linkRouting={buildMarkdownLinkRouting({ onOpenLocalFileLink })}
      />,
    );

    const link = screen.getByRole("link", { name: "Summary" });
    expect(link.getAttribute("href")).toBe("current/branch-summary.md");

    fireEvent.click(link);

    expect(onOpenLocalFileLink).not.toHaveBeenCalled();
  });

  it("does not treat web links or in-document anchors as relative file links", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content={["[Docs](https://example.com/docs)", "[Top](#heading)"].join(
          "\n\n",
        )}
        linkRouting={buildMarkdownLinkRouting({
          onOpenLocalFileLink,
          relativeLinks: {
            baseDir: "/storage/thr_1",
            rootPath: "/storage/thr_1",
          },
        })}
      />,
    );

    const docsLink = screen.getByRole("link", { name: "Docs" });
    const topLink = screen.getByRole("link", { name: "Top" });
    expect(docsLink.getAttribute("href")).toBe("https://example.com/docs");
    expect(topLink.getAttribute("href")).toBe("#heading");

    fireEvent.click(docsLink);
    fireEvent.click(topLink);

    expect(onOpenLocalFileLink).not.toHaveBeenCalled();
  });

  it("preserves custom URL transforms while local file handling is enabled", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    const rewriteDocsUrl: UrlTransform = (value) =>
      value === "https://example.com/docs"
        ? "https://docs.example.test/internal"
        : value;

    render(
      <MarkdownPreview
        content="[Docs](https://example.com/docs)"
        linkRouting={buildMarkdownLinkRouting({
          onOpenLocalFileLink,
          relativeLinks: {
            baseDir: "/storage/thr_1",
            rootPath: "/storage/thr_1",
          },
        })}
        urlTransform={rewriteDocsUrl}
      />,
    );

    expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe(
      "https://docs.example.test/internal",
    );
    expect(onOpenLocalFileLink).not.toHaveBeenCalled();
  });

  it("renders external links as blank-target anchors for desktop handling", () => {
    render(<MarkdownPreview content="[Docs](https://example.com/docs)" />);

    const link = screen.getByRole("link", { name: "Docs" });

    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("routes app links through client-side navigation", () => {
    const onOpenLink = vi.fn(() => true);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRouteNavigationProvider>
          <MarkdownPreview
            content="[Thread](/projects/proj_1/threads/thr_1?panel=files#row)"
            linkRouting={buildMarkdownLinkRouting({ onOpenLink })}
          />
          <LocationProbe label="location" />
        </AppRouteNavigationProvider>
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "Thread" });
    const notDefaultPrevented = fireEvent.click(link);

    expect(link.getAttribute("target")).toBeNull();
    expect(link.getAttribute("rel")).toBeNull();
    expect(onOpenLink).not.toHaveBeenCalled();
    expect(notDefaultPrevented).toBe(false);
    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/proj_1/threads/thr_1?panel=files#row",
    );
  });

  it("routes web link clicks through onOpenLink and prevents default when handled", () => {
    const onOpenLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Docs](https://example.com/docs)"
        linkRouting={buildMarkdownLinkRouting({ onOpenLink })}
      />,
    );

    const link = screen.getByRole("link", { name: "Docs" });
    const notDefaultPrevented = fireEvent.click(link);

    expect(onOpenLink).toHaveBeenCalledTimes(1);
    expect(onOpenLink).toHaveBeenCalledWith({
      href: "https://example.com/docs",
    });
    expect(notDefaultPrevented).toBe(false);
  });

  it("leaves the web link as a normal anchor when onOpenLink declines", () => {
    const onOpenLink = vi.fn(() => false);
    render(
      <MarkdownPreview
        content="[Docs](https://example.com/docs)"
        linkRouting={buildMarkdownLinkRouting({ onOpenLink })}
      />,
    );

    const link = screen.getByRole("link", { name: "Docs" });
    const notDefaultPrevented = fireEvent.click(link);

    expect(onOpenLink).toHaveBeenCalledWith({
      href: "https://example.com/docs",
    });
    expect(notDefaultPrevented).toBe(true);
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("prefers the local-file handler over onOpenLink for local file links", () => {
    const onOpenLink = vi.fn(() => true);
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Open absolute](/workspace/src/app.ts:12)"
        linkRouting={buildMarkdownLinkRouting({
          onOpenLink,
          onOpenLocalFileLink,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Open absolute" }));

    expect(onOpenLocalFileLink).toHaveBeenCalledTimes(1);
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("normalizes local file links only when local file routing is enabled", () => {
    const content = "[Notes](/Users/me/My Notes/app.md)";
    const withoutNormalization = render(<MarkdownPreview content={content} />);
    expect(
      withoutNormalization.queryByRole("link", { name: "Notes" }),
    ).toBeNull();
    withoutNormalization.unmount();

    render(
      <MarkdownPreview
        content={content}
        linkRouting={buildMarkdownLinkRouting({
          onOpenLocalFileLink: vi.fn(() => true),
        })}
      />,
    );

    expect(screen.getByRole("link", { name: "Notes" })).toBeTruthy();
  });

  it("renders inline code and block code with copy affordance", () => {
    const writeText = installClipboardWriteTextMock();
    render(
      <MarkdownPreview
        content={[
          "Run `pnpm test` before merging.",
          "",
          "```ts",
          "const value = 1;",
          "```",
        ].join("\n")}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith("const value = 1;");
  });

  it("opens the clicked image in the lightbox", () => {
    setupMatchMedia();
    render(
      <MarkdownPreview
        content={[
          "![One](https://example.test/one.png)",
          "![Two](https://example.test/two.png)",
        ].join("\n")}
      />,
    );

    fireEvent.click(screen.getByRole("img", { name: "Two" }));

    expect(
      screen.getByRole("img", { name: "Expanded image" }).getAttribute("src"),
    ).toBe("https://example.test/two.png");
  });

});
