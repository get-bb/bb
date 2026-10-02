import { describe, expect, it } from "vitest";
import { normalizeLocalFileMarkdownLinks } from "./markdown-local-file-link-normalize.js";

describe("normalizeLocalFileMarkdownLinks", () => {
  it("wraps absolute local link destinations that contain literal spaces", () => {
    const content = [
      "[Candidate Changelog \u2014 Since 0.9.1](",
      "/Users/brsbl/Moss/Notes/Agent Workspaces/bb Workspace/workstreams/",
      "moss-skills-distribution-discovery/",
      "Candidate%20Changelog%20%E2%80%94%20Since%200.9.1/",
      "Candidate%20Changelog%20%E2%80%94%20Since%200.9.1.md)",
    ].join("");

    expect(normalizeLocalFileMarkdownLinks(content)).toBe(
      [
        "[Candidate Changelog \u2014 Since 0.9.1](",
        "</Users/brsbl/Moss/Notes/Agent Workspaces/bb Workspace/workstreams/",
        "moss-skills-distribution-discovery/",
        "Candidate%20Changelog%20%E2%80%94%20Since%200.9.1/",
        "Candidate%20Changelog%20%E2%80%94%20Since%200.9.1.md>)",
      ].join(""),
    );
  });

  it("leaves already valid and non-local markdown links alone", () => {
    expect(
      normalizeLocalFileMarkdownLinks("[file](/workspace/src/app.ts)"),
    ).toBe("[file](/workspace/src/app.ts)");
    expect(
      normalizeLocalFileMarkdownLinks('[file](/workspace/src/app.ts "Title")'),
    ).toBe('[file](/workspace/src/app.ts "Title")');
    expect(
      normalizeLocalFileMarkdownLinks("[docs](https://example.test/a b)"),
    ).toBe("[docs](https://example.test/a b)");
    expect(
      normalizeLocalFileMarkdownLinks("[file](</workspace/path with/app.ts>)"),
    ).toBe("[file](</workspace/path with/app.ts>)");
  });

  it("preserves link titles when wrapping local destinations with literal spaces", () => {
    expect(
      normalizeLocalFileMarkdownLinks(
        '[file](/Users/me/My Notes/app.md "Double title")',
      ),
    ).toBe('[file](</Users/me/My Notes/app.md> "Double title")');
    expect(
      normalizeLocalFileMarkdownLinks(
        "[file](/Users/me/My Notes/app.md 'Single title')",
      ),
    ).toBe("[file](</Users/me/My Notes/app.md> 'Single title')");
    expect(
      normalizeLocalFileMarkdownLinks(
        "[file](/Users/me/My Notes/app.md (Parenthesized title))",
      ),
    ).toBe("[file](</Users/me/My Notes/app.md> (Parenthesized title))");
  });

  it("does not absorb malformed quoted titles into local destinations", () => {
    const content = '[a](/Users/me/My Notes/x.md "evil) [b](/foo/bar")';

    expect(normalizeLocalFileMarkdownLinks(content)).toBe(content);
  });

  it("unescapes markdown destination punctuation before wrapping", () => {
    expect(
      normalizeLocalFileMarkdownLinks(
        String.raw`[a](/Users/me/foo bar\)/x.md)`,
      ),
    ).toBe("[a](</Users/me/foo bar)/x.md>)");
  });

  it("wraps local file destinations with section fragments", () => {
    expect(
      normalizeLocalFileMarkdownLinks(
        "[file](/Users/me/My Notes/app.md#section)",
      ),
    ).toBe("[file](</Users/me/My Notes/app.md#section>)");
  });

  it("does not rewrite code spans or fenced code blocks", () => {
    const content = [
      "`[inline](/Users/me/Agent Workspaces/file.md)`",
      "",
      "```md",
      "[code](/Users/me/Agent Workspaces/file.md)",
      "```",
      "",
      "[real](/Users/me/Agent Workspaces/file.md)",
    ].join("\n");

    expect(normalizeLocalFileMarkdownLinks(content)).toBe(
      [
        "`[inline](/Users/me/Agent Workspaces/file.md)`",
        "",
        "```md",
        "[code](/Users/me/Agent Workspaces/file.md)",
        "```",
        "",
        "[real](</Users/me/Agent Workspaces/file.md>)",
      ].join("\n"),
    );
  });

  it("does not rewrite indented code blocks", () => {
    const content = [
      "Paragraph.",
      "",
      "    [code](/Users/me/Agent Workspaces/file.md)",
      "",
      "[real](/Users/me/Agent Workspaces/file.md)",
    ].join("\n");

    expect(normalizeLocalFileMarkdownLinks(content)).toBe(
      [
        "Paragraph.",
        "",
        "    [code](/Users/me/Agent Workspaces/file.md)",
        "",
        "[real](</Users/me/Agent Workspaces/file.md>)",
      ].join("\n"),
    );
  });

  it("turns Windows drive destinations into forward-slash paths Markdown keeps intact", () => {
    expect(
      normalizeLocalFileMarkdownLinks(
        "[config](C:\\src\\repo\\.config\\app.json) and [doc](C:/src/repo/README.md:12)",
      ),
    ).toBe(
      "[config](<C:/src/repo/.config/app.json>) and [doc](<C:/src/repo/README.md:12>)",
    );
  });

  it("wraps Windows drive destinations that contain spaces", () => {
    expect(
      normalizeLocalFileMarkdownLinks(
        "[notes](C:\\Users\\me\\My Notes\\plan.md)",
      ),
    ).toBe("[notes](<C:/Users/me/My Notes/plan.md>)");
  });

  it("leaves a drive-like scheme that is not a file path alone", () => {
    const content = "[x](C:not-a-path) and [mail](mailto:me@example.com)";
    expect(normalizeLocalFileMarkdownLinks(content)).toBe(content);
  });
});
