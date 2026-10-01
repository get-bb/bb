import { describe, expect, it } from "vitest";
import {
  resolveDesktopExternalUrl,
  resolveEditorFilePath,
} from "../src/index.js";

describe("resolveDesktopExternalUrl", () => {
  it.each([
    [
      "devin://file/Users/me/.bb/artifacts/thr_1/cloudflare-iac-review.diff",
      "devin://file/Users/me/.bb/artifacts/thr_1/cloudflare-iac-review.diff",
    ],
    [
      "windsurf://file/Users/me/app.ts:12",
      "windsurf://file/Users/me/app.ts:12",
    ],
    [
      "vscode://file/Users/me/app.ts:12:3",
      "vscode://file/Users/me/app.ts:12:3",
    ],
    [
      "vscode-insiders://file/Users/me/My%20Notes.md",
      "vscode-insiders://file/Users/me/My%20Notes.md",
    ],
    ["cursor://file/c:/repo/app.ts", "cursor://file/c:/repo/app.ts"],
    ["cursor://file/C:/repo/app.ts:4:2", "cursor://file/C:/repo/app.ts:4:2"],
    ["devin://file/Users/me/v1..2.txt", "devin://file/Users/me/v1..2.txt"],
    [
      "devin://file/Users/me/notes:draft.md:3",
      "devin://file/Users/me/notes:draft.md:3",
    ],
    ["DEVIN://file/Users/me/app.ts", "devin://file/Users/me/app.ts"],
    ["https://example.com/docs?q=1#a", "https://example.com/docs?q=1#a"],
    ["http://localhost:5173", "http://localhost:5173/"],
    ["mailto:hi@example.com", "mailto:hi@example.com"],
  ])("opens %s", (value, expected) => {
    expect(resolveDesktopExternalUrl(value)).toBe(expected);
  });

  it.each([
    ["javascript protocol", "javascript:alert(1)"],
    ["data protocol", "data:text/html,<script>alert(1)</script>"],
    ["file protocol", "file:///Applications/Calculator.app"],
    ["ms-msdt protocol", "ms-msdt:/id PCWDiagnostic"],
    ["unknown protocol", "obsidian://open?vault=lake"],
    ["unvalidated editor protocol", "zed://file/Users/me/app.ts"],
    [
      "Devin plugin install action",
      "devin://chat-plugin/install?source=https://example.invalid/plugin",
    ],
    [
      "VS Code extension handler",
      "vscode://vscode.git/clone?url=https://example.invalid/repo.git",
    ],
    ["VS Code command URI", "vscode://command/workbench.action.terminal.new"],
    [
      "file authority with query",
      "vscode://file/Users/me/app.ts?windowId=_blank",
    ],
    ["file authority with empty query", "devin://file/Users/me/app.ts?"],
    ["file authority with fragment", "devin://file/Users/me/app.ts#L1"],
    ["credentials", "devin://user:pass@file/Users/me/app.ts"],
    ["port", "devin://file:8080/Users/me/app.ts"],
    ["uppercase authority", "devin://FILE/Users/me/app.ts"],
    ["missing path", "devin://file/"],
    ["network path", "devin://file//server/share/app.ts"],
    ["encoded network path", "devin://file/%2Fserver/share/a.diff"],
    ["encoded empty segment", "devin://file/Users%2F%2Fme/a.diff"],
    ["trailing slash", "devin://file/Users/me/"],
    ["opaque form", "devin:file/Users/me/app.ts"],
    ["parent traversal", "devin://file/Users/me/../../etc/passwd"],
    ["parent hidden by line suffix", "vscode://file/tmp/..:1"],
    ["parent hidden by line and column", "vscode://file/tmp/..:1:2"],
    ["encoded parent hidden by line suffix", "vscode://file/tmp/%2e%2e:1"],
    [
      "encoded parent hidden by line and column",
      "vscode://file/tmp/%2E%2E:1:2",
    ],
    ["current directory hidden by line suffix", "vscode://file/tmp/.:1"],
    ["Windows dot-space segment", "vscode://file/c:/repo/..%20:1"],
    ["bare line suffix segment", "devin://file/tmp/:1"],
    ["more than line and column", "vscode://file/tmp/review:1:2:3"],
    ["many numeric suffixes", "vscode://file/tmp/..:1:2:3:4"],
    ["trailing empty colon piece", "vscode://file/tmp/proj:"],
    ["parent with empty colon pieces", "vscode://file/tmp/..::"],
    ["parent with encoded colons", "vscode://file/tmp/..%3A%3A"],
    ["parent with space piece", "vscode://file/tmp/..:%20"],
    ["parent with non-breaking space piece", "vscode://file/tmp/..:%C2%A0"],
    ["parent with hex piece", "vscode://file/tmp/..:0x1"],
    ["parent with exponent piece", "vscode://file/tmp/..:1e3"],
    ["parent with negative piece", "vscode://file/tmp/..:-1"],
    ["parent with Infinity piece", "vscode://file/tmp/..:Infinity"],
    ["root with empty colon pieces", "vscode://file/::"],
    ["home with empty colon pieces", "vscode://file/Users/me/::"],
    ["mid-path numeric piece", "vscode://file/r/d:1:x:2"],
    ["drive root directory", "cursor://file/c:/:1"],
    ["workspace file", "vscode://file/tmp/review.code-workspace"],
    ["encoded workspace file", "vscode://file/tmp/review%2Ecode-workspace"],
    ["workspace file with line suffix", "vscode://file/tmp/a.CODE-WORKSPACE:1"],
    [
      "workspace file with trailing dot",
      "vscode://file/c:/repo/a.code-workspace.",
    ],
    ["encoded traversal", "devin://file/Users/me/%2e%2e/secret"],
    ["encoded newline", "devin://file/Users/me/app.ts%0Aevil"],
    ["encoded backslash", "devin://file/Users/me%5Capp.ts"],
    ["malformed encoding", "devin://file/Users/me/%E0%A4%A"],
    ["raw whitespace", "devin://file/Users/me/my app.ts"],
    ["raw control character", "https://example.com/\u0000"],
    ["raw newline", "https://exam\nple.com"],
    ["relative path", "/threads/thr_1"],
    ["non-string payload", { url: "https://example.com" }],
  ])("rejects %s", (_name, value) => {
    expect(resolveDesktopExternalUrl(value)).toBeNull();
  });
});

describe("resolveEditorFilePath", () => {
  it.each([
    ["vscode://file/Users/me/app.ts:12:3", "/Users/me/app.ts"],
    ["devin://file/Users/me/My%20Notes.md", "/Users/me/My Notes.md"],
    ["cursor://file/c:/repo/app.ts:4", "c:/repo/app.ts"],
  ])("resolves %s to the local file %s", (value, expected) => {
    expect(resolveEditorFilePath(value)).toBe(expected);
  });

  it("returns null for web and rejected editor URLs", () => {
    expect(resolveEditorFilePath("https://example.com/a.ts")).toBeNull();
    expect(resolveEditorFilePath("vscode://file/tmp/..:1")).toBeNull();
  });
});
