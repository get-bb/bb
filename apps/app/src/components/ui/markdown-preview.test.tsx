// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./markdown-preview";
import {
  MarkdownLocalFileOpenWithContext,
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
  it("syntax-highlights fenced code blocks", () => {
    const { container } = render(
      <MarkdownPreview content={"```ts\nconst x = 1;\n```"} />,
    );
    expect(container.querySelector(".sh__line")).not.toBeNull();
    expect(container.querySelector(".sh__token--keyword")).not.toBeNull();
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

  it("toggles soft wrap on a fenced code block", () => {
    const { container } = render(
      <MarkdownPreview content={"```ts\nconst value = 1;\n```"} />,
    );
    const pre = container.querySelector("pre");
    expect(pre?.classList.contains("overflow-x-auto")).toBe(true);
    expect(pre?.classList.contains("whitespace-pre-wrap")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Wrap long lines" }));
    expect(pre?.classList.contains("whitespace-pre-wrap")).toBe(true);
    expect(pre?.classList.contains("overflow-x-auto")).toBe(false);
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

  it("shows an Open with menu on local file links when the context provides items", () => {
    const openBuiltin = vi.fn();
    const openWithPlugin = vi.fn();
    render(
      <MarkdownLocalFileOpenWithContext.Provider
        value={(link) =>
          link.path.endsWith(".md")
            ? [
                {
                  id: "builtin",
                  label: "Open with built-in preview",
                  onSelect: openBuiltin,
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
      </MarkdownLocalFileOpenWithContext.Provider>,
    );

    const link = screen.getByRole("link", { name: /notes/ });
    fireEvent.contextMenu(link);
    fireEvent.click(screen.getByText("Open with Notes editor"));
    expect(openWithPlugin).toHaveBeenCalledTimes(1);
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

  it("lets long local file link labels wrap without making the anchor flex", () => {
    const href =
      "file:///Users/brsbl/Moss/Notes/Agent%20Workspaces/Claude%20Workspace/Release%20Readiness%20Inventory%20%E2%80%94%20Next%20Release/Release%20Readiness%20Inventory%20%E2%80%94%20Next%20Release.md";

    render(
      <MarkdownPreview
        content={`[${href}](${href})`}
        linkRouting={workspaceLinkRouting}
      />,
    );

    const link = screen.getByRole("link", { name: href });

    expect(link.classList.contains("[overflow-wrap:anywhere]")).toBe(true);
    expect(link.classList.contains("inline-flex")).toBe(false);
    expect(link.querySelector('[data-icon="ExternalLink"]')).not.toBeNull();
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
