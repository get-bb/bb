// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./markdown-preview";
import {
  MarkdownLocalFileContextMenuContext,
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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("MarkdownPreview", () => {
  it("HTML-escapes fenced code so it cannot inject markup", () => {
    const { container } = render(
      <MarkdownPreview
        content={'```ts\nconst html = "<script>alert(1)</script>";\n```'}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("renders inline-code Markdown file paths as local file links", () => {
    render(
      <MarkdownPreview
        content="Read `README.md`, `docs/guide.markdown:4`, and `src/app.ts`."
        linkRouting={workspaceLinkRouting}
      />,
    );

    expect(
      screen.getByRole("link", { name: "README.md" }).getAttribute("href"),
    ).toBe("file:///workspace/README.md");
    expect(
      screen
        .getByRole("link", { name: "docs/guide.markdown:4" })
        .getAttribute("href"),
    ).toBe("file:///workspace/docs/guide.markdown#L4");
    expect(screen.getByText("src/app.ts").tagName).toBe("CODE");
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

    // The provider returned null for the .ts link — plain anchor, no menu.
    fireEvent.contextMenu(screen.getByRole("link", { name: /app/ }));
    expect(screen.queryByText(/Open with/)).toBeNull();
  });

  it("leaves inline-code Markdown paths as code without local file routing", () => {
    render(<MarkdownPreview content="Read `README.md`." />);

    expect(screen.queryByRole("link", { name: "README.md" })).toBeNull();
    expect(screen.getByText("README.md").tagName).toBe("CODE");
  });

  it("lets link routing open absolute app-origin URLs", () => {
    const onOpenLink = vi.fn(() => true);
    const href = `${window.location.origin}/threads/thr_localhost`;

    render(
      <MarkdownPreview
        content={`Open [local thread](${href}).`}
        linkRouting={{ onOpenLink }}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "local thread" }));

    expect(onOpenLink).toHaveBeenCalledWith({ href });
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

  it("renders inline LaTeX math with KaTeX", () => {
    const { container } = render(
      <MarkdownPreview content={"Mass-energy is $$E = mc^2$$ exactly."} />,
    );

    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-display")).toBeNull();
  });

  it("leaves single-dollar spans as literal text", () => {
    const { container } = render(
      <MarkdownPreview
        content={"It went from $5 to $10 last week, so $x$ stays literal."}
      />,
    );

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$5 to $10");
    expect(container.textContent).toContain("$x$");
  });

  it("renders display LaTeX math blocks with KaTeX", () => {
    const { container } = render(
      <MarkdownPreview content={"$$\n\\frac{1}{2} + \\frac{1}{2} = 1\n$$"} />,
    );

    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("leaves escaped dollar amounts as literal text", () => {
    const { container } = render(
      <MarkdownPreview content={"It went from \\$5 to \\$10 last week."} />,
    );

    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$5");
    expect(container.textContent).toContain("$10");
  });

  it("renders math while still sanitizing untrusted HTML when allowHtml is set", () => {
    const { container } = render(
      <MarkdownPreview
        allowHtml
        content={"$$a^2 + b^2 = c^2$$\n\n<script>alert(1)</script>"}
      />,
    );

    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toContain("alert(1)");
  });

  it("contains invalid TeX instead of throwing", () => {
    const { container } = render(
      <MarkdownPreview content={"Broken: $$\\frac{1}{$$ keeps rendering."} />,
    );

    expect(container.querySelector(".katex-error")).not.toBeNull();
    expect(container.textContent).toContain("keeps rendering.");
  });
});
