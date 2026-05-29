// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import {
  restoreMatchMedia,
  setupMatchMedia,
} from "@/test/helpers/match-media.js";
import { setPreferredTheme } from "@/hooks/useTheme";

type ClipboardWriteText = (text: string) => Promise<void>;

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
        onOpenLocalFileLink={onOpenLocalFileLink}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Open absolute" }));

    expect(onOpenLocalFileLink).toHaveBeenCalledTimes(1);
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineNumber: 12,
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
        normalizeLocalFileLinks
        onOpenLocalFileLink={onOpenLocalFileLink}
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
      lineNumber: null,
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
        normalizeLocalFileLinks
        onOpenLocalFileLink={onOpenLocalFileLink}
      />,
    );

    const link = screen.getByRole("link", { name: "Notes" });
    expect(link.getAttribute("href")).toBe(
      "file:///Users/me/My%20Notes/app.md",
    );
    expect(link.getAttribute("title")).toBe("My doc");

    fireEvent.click(link);

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineNumber: null,
      path: "/Users/me/My Notes/app.md",
    });
  });

  it("renders local file links with section fragments as local file links", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Notes](/Users/me/My Notes/app.md#section)"
        normalizeLocalFileLinks
        onOpenLocalFileLink={onOpenLocalFileLink}
      />,
    );

    const link = screen.getByRole("link", { name: "Notes" });
    expect(link.getAttribute("href")).toBe(
      "file:///Users/me/My%20Notes/app.md#section",
    );

    fireEvent.click(link);

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineNumber: null,
      path: "/Users/me/My Notes/app.md",
    });
  });

  it("renders external links as blank-target anchors for desktop handling", () => {
    render(<MarkdownPreview content="[Docs](https://example.com/docs)" />);

    const link = screen.getByRole("link", { name: "Docs" });

    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("routes web link clicks through onOpenLink and prevents default when handled", () => {
    const onOpenLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content="[Docs](https://example.com/docs)"
        onOpenLink={onOpenLink}
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
        onOpenLink={onOpenLink}
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
        onOpenLink={onOpenLink}
        onOpenLocalFileLink={onOpenLocalFileLink}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Open absolute" }));

    expect(onOpenLocalFileLink).toHaveBeenCalledTimes(1);
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it("normalizes local file links only when explicitly requested", () => {
    const content = "[Notes](/Users/me/My Notes/app.md)";
    const withoutNormalization = render(<MarkdownPreview content={content} />);
    expect(
      withoutNormalization.queryByRole("link", { name: "Notes" }),
    ).toBeNull();
    withoutNormalization.unmount();

    render(<MarkdownPreview content={content} normalizeLocalFileLinks />);

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
