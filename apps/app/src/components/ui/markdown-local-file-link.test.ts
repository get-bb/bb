import { describe, expect, it } from "vitest";
import {
  buildLocalFileAnchorHref,
  parseLocalFileHref,
  resolveRelativeLocalFileHref,
  type MarkdownAbsoluteLocalFileLinkRouting,
} from "./markdown-local-file-link.js";

const TRUSTED_HOST_ABSOLUTE_LINKS = {
  kind: "trusted-host",
} satisfies MarkdownAbsoluteLocalFileLinkRouting;
const CONTAINED_WORKSPACE_ABSOLUTE_LINKS = {
  kind: "contained",
  rootPath: "/workspace",
} satisfies MarkdownAbsoluteLocalFileLinkRouting;

describe("parseLocalFileHref", () => {
  it("parses absolute local paths and file URLs with optional line numbers", () => {
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "/workspace/src/app.ts",
      }),
    ).toEqual({
      path: "/workspace/src/app.ts",
      lineRange: null,
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "/workspace/src/app.ts:12",
      }),
    ).toEqual({
      path: "/workspace/src/app.ts",
      lineRange: { startLineNumber: 12, endLineNumber: 12 },
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "/workspace/src/app.ts#L12",
      }),
    ).toEqual({
      path: "/workspace/src/app.ts",
      lineRange: { startLineNumber: 12, endLineNumber: 12 },
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "/workspace/src/app.ts#L12-L15",
      }),
    ).toEqual({
      path: "/workspace/src/app.ts",
      lineRange: { startLineNumber: 12, endLineNumber: 15 },
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "/workspace/src/app.ts#L12C3-L15C8",
      }),
    ).toEqual({
      path: "/workspace/src/app.ts",
      lineRange: { startLineNumber: 12, endLineNumber: 15 },
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "/workspace/src/app.ts:12:34",
      }),
    ).toEqual({
      path: "/workspace/src/app.ts",
      lineRange: { startLineNumber: 12, endLineNumber: 12 },
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "/workspace/src/app.ts:12-15",
      }),
    ).toEqual({
      path: "/workspace/src/app.ts",
      lineRange: { startLineNumber: 12, endLineNumber: 15 },
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "file:///workspace/src/file-url.ts#L4",
      }),
    ).toEqual({
      path: "/workspace/src/file-url.ts",
      lineRange: { startLineNumber: 4, endLineNumber: 4 },
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "/work%20space/app.ts:3",
      }),
    ).toEqual({
      path: "/work space/app.ts",
      lineRange: { startLineNumber: 3, endLineNumber: 3 },
    });
  });

  it("applies the same containment policy to absolute paths and file URLs", () => {
    expect(
      parseLocalFileHref({
        absoluteLinks: CONTAINED_WORKSPACE_ABSOLUTE_LINKS,
        href: "/workspace/src/../README",
      }),
    ).toEqual({
      lineRange: null,
      path: "/workspace/README",
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: CONTAINED_WORKSPACE_ABSOLUTE_LINKS,
        href: "file:///workspace/src/../README",
      }),
    ).toEqual({
      lineRange: null,
      path: "/workspace/README",
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: CONTAINED_WORKSPACE_ABSOLUTE_LINKS,
        href: "/etc/shadow",
      }),
    ).toBeNull();
    expect(
      parseLocalFileHref({
        absoluteLinks: CONTAINED_WORKSPACE_ABSOLUTE_LINKS,
        href: "file:///etc/shadow",
      }),
    ).toBeNull();
  });

  it("rejects hrefs that are not unambiguous absolute local files", () => {
    for (const href of [
      "apps/app/src/main.tsx",
      "README.md",
      "https://example.test",
      "file:///workspace/app.ts?foo=1",
      "file://host/workspace/app.ts",
      "//workspace/app.ts",
      "/workspace/app.ts:0",
      "/workspace/app.ts#L0",
      "/workspace/app.ts#L10-L9",
      "/workspace/app.ts:10-9",
      "/work%00space/file.ts",
      "/workspace/no-extension",
    ]) {
      expect(
        parseLocalFileHref({
          absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
          href,
        }),
      ).toBeNull();
    }
  });

  it("parses local file links with non-line fragments as the file path", () => {
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "/workspace/app.ts#section",
      }),
    ).toEqual({
      path: "/workspace/app.ts",
      lineRange: null,
    });
    for (const href of [
      "/workspace/with#hash/app.ts:12",
      "/workspace/app.ts#bad/fragment",
      "/workspace/app.ts#one#two",
    ]) {
      expect(
        parseLocalFileHref({
          absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
          href,
        }),
      ).toBeNull();
    }
  });
});

describe("buildLocalFileAnchorHref", () => {
  it("rewrites absolute file-like paths while leaving non-file hrefs alone", () => {
    expect(
      buildLocalFileAnchorHref(
        {
          path: "apps/app/main.tsx",
          lineRange: { startLineNumber: 4, endLineNumber: 4 },
        },
        "apps/app/main.tsx:4",
      ),
    ).toBe("apps/app/main.tsx:4");
    expect(
      buildLocalFileAnchorHref(
        {
          path: "/workspace/src/app.ts",
          lineRange: { startLineNumber: 12, endLineNumber: 12 },
        },
        "/workspace/src/app.ts:12",
      ),
    ).toBe("file:///workspace/src/app.ts#L12");
    expect(
      buildLocalFileAnchorHref(
        { path: "/workspace/README.md", lineRange: null },
        "/workspace/README.md",
      ),
    ).toBe("file:///workspace/README.md");
    expect(
      buildLocalFileAnchorHref(
        { path: "/workspace/README.md", lineRange: null },
        "/workspace/README.md#intro",
      ),
    ).toBe("file:///workspace/README.md");
    expect(
      buildLocalFileAnchorHref(
        {
          path: "/work space/app.ts",
          lineRange: { startLineNumber: 3, endLineNumber: 3 },
        },
        "/work space/app.ts:3",
      ),
    ).toBe("file:///work%20space/app.ts#L3");
    expect(
      buildLocalFileAnchorHref(
        {
          path: "/work space/app.ts",
          lineRange: { startLineNumber: 3, endLineNumber: 5 },
        },
        "/work space/app.ts#L3-L5",
      ),
    ).toBe("file:///work%20space/app.ts#L3-L5");
  });

  it("rewrites parsed extensionless file URLs consistently with click handling", () => {
    expect(
      buildLocalFileAnchorHref(
        { path: "/workspace/no-extension", lineRange: null },
        "file:///workspace/no-extension",
      ),
    ).toBe("file:///workspace/no-extension");
  });
});

describe("resolveRelativeLocalFileHref", () => {
  it("normalizes relative paths that stay inside the containing root", () => {
    expect(
      resolveRelativeLocalFileHref({
        baseDir: "/storage/thr_1/current/docs",
        href: "../summary.md#L7",
        rootPath: "/storage/thr_1",
      }),
    ).toBe("/storage/thr_1/current/summary.md#L7");
  });

  it("parses file line suffixes before checking URI schemes", () => {
    expect(
      resolveRelativeLocalFileHref({
        baseDir: "/workspace",
        href: "Cargo.lock:14:33",
        rootPath: "/workspace",
      }),
    ).toBe("/workspace/Cargo.lock:14:33");
    expect(
      resolveRelativeLocalFileHref({
        baseDir: "/workspace",
        href: "foo.md:5",
        rootPath: "/workspace",
      }),
    ).toBe("/workspace/foo.md:5");
    expect(
      resolveRelativeLocalFileHref({
        baseDir: "/workspace",
        href: "foo:5",
        rootPath: "/workspace",
      }),
    ).toBe("/workspace/foo:5");
  });

  it("does not reinterpret URI schemes as relative file links", () => {
    expect(
      resolveRelativeLocalFileHref({
        baseDir: "/workspace",
        href: "git+ssh://example.test/repo.git",
        rootPath: "/workspace",
      }),
    ).toBeNull();
  });

  it("rejects relative paths that escape the containing root", () => {
    expect(
      resolveRelativeLocalFileHref({
        baseDir: "/storage/thr_1/current/docs",
        href: "../../../secret.md",
        rootPath: "/storage/thr_1",
      }),
    ).toBeNull();
  });

  it("rejects encoded dot-segment escapes before local-file parsing", () => {
    expect(
      resolveRelativeLocalFileHref({
        baseDir: "/storage/thr_1/current/docs",
        href: "%2e%2e/%2e%2e/%2e%2e/secret.md",
        rootPath: "/storage/thr_1",
      }),
    ).toBeNull();
  });
});
