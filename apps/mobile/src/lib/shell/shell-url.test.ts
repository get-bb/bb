import { describe, expect, it } from "vitest";
import {
  buildShellUrl,
  isExternallyOpenable,
  isShellNavigation,
  resolveShellWindowOpen,
  shellPathFromUrl,
} from "./shell-url";

const ROOT = "https://bee.getbb.app";
const PREFIXED = "https://box.example.ts.net/bb";

describe("buildShellUrl", () => {
  it("joins a page path onto a server mounted at the root", () => {
    expect(buildShellUrl(ROOT, "/")).toBe("https://bee.getbb.app/");
    expect(buildShellUrl(`${ROOT}/`, "/threads/thr_1")).toBe(
      "https://bee.getbb.app/threads/thr_1",
    );
    expect(buildShellUrl(ROOT, "/threads/thr_1?tab=diff")).toBe(
      "https://bee.getbb.app/threads/thr_1?tab=diff",
    );
  });

  it("keeps a server's path prefix", () => {
    expect(buildShellUrl(PREFIXED, "/")).toBe("https://box.example.ts.net/bb/");
    expect(buildShellUrl(PREFIXED, "/threads/thr_1")).toBe(
      "https://box.example.ts.net/bb/threads/thr_1",
    );
  });

  it("tolerates a path with no leading slash", () => {
    expect(buildShellUrl(ROOT, "threads/thr_1")).toBe(
      "https://bee.getbb.app/threads/thr_1",
    );
  });
});

describe("isShellNavigation", () => {
  it("keeps the profile's own pages in the WebView", () => {
    expect(isShellNavigation("https://bee.getbb.app/threads/x", ROOT)).toBe(
      true,
    );
    expect(isShellNavigation("https://bee.getbb.app/", ROOT)).toBe(true);
  });

  it("sends another origin to the system browser", () => {
    expect(isShellNavigation("https://example.com/docs", ROOT)).toBe(false);
    expect(isShellNavigation("https://other.getbb.app/", ROOT)).toBe(false);
    expect(isShellNavigation("http://bee.getbb.app/", ROOT)).toBe(false);
  });

  it("does not let a sibling path escape a prefixed mount", () => {
    expect(isShellNavigation("https://box.example.ts.net/bb/x", PREFIXED)).toBe(
      true,
    );
    expect(
      isShellNavigation("https://box.example.ts.net/bbadmin", PREFIXED),
    ).toBe(false);
    expect(
      isShellNavigation("https://box.example.ts.net/other", PREFIXED),
    ).toBe(false);
  });

  it("refuses a URL that will not parse", () => {
    expect(isShellNavigation("not a url", ROOT)).toBe(false);
    expect(isShellNavigation("https://bee.getbb.app/", "not a url")).toBe(
      false,
    );
  });
});

describe("shellPathFromUrl", () => {
  it("returns the page path, minus any mount prefix", () => {
    expect(shellPathFromUrl("https://bee.getbb.app/threads/x?a=1", ROOT)).toBe(
      "/threads/x?a=1",
    );
    expect(shellPathFromUrl("https://bee.getbb.app/", ROOT)).toBe("/");
    expect(
      shellPathFromUrl("https://box.example.ts.net/bb/threads/x", PREFIXED),
    ).toBe("/threads/x");
    expect(shellPathFromUrl("https://box.example.ts.net/bb", PREFIXED)).toBe(
      "/",
    );
  });

  it("returns null for a URL outside the profile", () => {
    expect(shellPathFromUrl("https://example.com/x", ROOT)).toBeNull();
  });
});

describe("isExternallyOpenable", () => {
  it("allows only the schemes a system browser should receive", () => {
    expect(isExternallyOpenable("https://example.com")).toBe(true);
    expect(isExternallyOpenable("http://10.0.0.2:1234/x")).toBe(true);
    expect(isExternallyOpenable("mailto:a@b.com")).toBe(true);
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "about:blank",
      "tel:+1234",
      "",
    ]) {
      expect(isExternallyOpenable(url), url).toBe(false);
    }
  });
});

describe("resolveShellWindowOpen", () => {
  it("keeps authenticated preview and download URLs inside the shell", () => {
    for (const path of [
      "/api/v1/projects/proj_1/attachments/a/preview",
      "/api/v1/projects/proj_1/attachments/a/download",
      "/api/v1/plugins/tasks/http/attachments/preview?attachmentId=att_1",
    ]) {
      const url = `${ROOT}${path}`;
      expect(resolveShellWindowOpen(url, ROOT)).toEqual({
        kind: "shell",
        url,
      });
    }
  });

  it("opens safe external URLs and rejects unsafe schemes", () => {
    expect(resolveShellWindowOpen("https://example.com/file", ROOT)).toEqual({
      kind: "external",
      url: "https://example.com/file",
    });
    expect(resolveShellWindowOpen("javascript:alert(1)", ROOT)).toEqual({
      kind: "reject",
    });
  });
});
