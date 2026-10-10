import { describe, expect, it } from "vitest";
import {
  buildShellUrl,
  isExternallyOpenable,
  isShellNavigation,
  resolveShellNavigation,
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

describe("resolveShellNavigation", () => {
  const navigate = (
    url: string,
    isTopFrame: boolean,
    navigationType = "other",
  ) => resolveShellNavigation({ url, isTopFrame, navigationType }, ROOT);

  it("loads the profile's own pages in the page and in its frames", () => {
    expect(navigate("https://bee.getbb.app/threads/x", true)).toBe("load");
    expect(
      navigate("https://bee.getbb.app/api/v1/plugins/canvas/http/frame", false),
    ).toBe("load");
  });

  it("opens a page-level navigation elsewhere in the system browser", () => {
    expect(navigate("https://example.com/docs", true)).toBe("open-external");
    expect(navigate("https://example.com/docs", true, "click")).toBe(
      "open-external",
    );
    expect(navigate("mailto:a@b.com", true, "click")).toBe("open-external");
  });

  it("treats a navigation without frame details as page-level, as Android sends it", () => {
    expect(
      resolveShellNavigation({ url: "https://getbb.app/sign-in" }, ROOT),
    ).toBe("open-external");
    expect(
      resolveShellNavigation({ url: "https://bee.getbb.app/threads/x" }, ROOT),
    ).toBe("load");
  });

  it("opens a link tapped inside an embedded frame", () => {
    expect(navigate("https://example.com/docs", false, "click")).toBe(
      "open-external",
    );
  });

  it("keeps an embed's own frame loads and redirects inside bb", () => {
    for (const navigationType of ["other", "reload", "backforward"]) {
      expect(
        navigate("https://www.youtube.com/embed/x", false, navigationType),
        navigationType,
      ).toBe("block");
    }
    expect(navigate("mailto:a@b.com", false)).toBe("block");
    expect(navigate("mailto:a@b.com", false, "click")).toBe("open-external");
  });

  it("keeps blank frames inside bb", () => {
    expect(navigate("about:blank", true)).toBe("block");
    expect(navigate("about:blank", false)).toBe("block");
  });
});
