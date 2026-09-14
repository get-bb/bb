import { describe, expect, it } from "vitest";
import {
  parseLocalFileHref,
  type MarkdownAbsoluteLocalFileLinkRouting,
} from "./markdown-local-file-link.js";

const TRUSTED_HOST_ABSOLUTE_LINKS = {
  kind: "trusted-host",
} satisfies MarkdownAbsoluteLocalFileLinkRouting;

describe("parseLocalFileHref on native Windows paths", () => {
  it("parses UNC local file links on trusted hosts", () => {
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "\\\\server\\share\\folder\\file.md",
      }),
    ).toEqual({
      path: "\\\\server\\share\\folder\\file.md",
      lineRange: null,
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "\\\\server\\share\\file.md:12",
      }),
    ).toEqual({
      path: "\\\\server\\share\\file.md",
      lineRange: { startLineNumber: 12, endLineNumber: 12 },
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: TRUSTED_HOST_ABSOLUTE_LINKS,
        href: "\\\\server\\share",
      }),
    ).toBeNull();
  });

  it("applies the same containment policy to native Windows paths", () => {
    const workspace = {
      kind: "contained",
      rootPath: "C:\\Users\\me\\project",
    } satisfies MarkdownAbsoluteLocalFileLinkRouting;
    expect(
      parseLocalFileHref({
        absoluteLinks: workspace,
        href: "C:/Users/me/project/docs/../README.md",
      }),
    ).toEqual({
      lineRange: null,
      path: "c:/Users/me/project/README.md",
    });
    expect(
      parseLocalFileHref({
        absoluteLinks: workspace,
        href: "C:\\Users\\me\\outside.md",
      }),
    ).toBeNull();
  });
});
