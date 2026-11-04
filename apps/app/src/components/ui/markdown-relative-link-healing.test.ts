import type { PathResolution } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  chooseRelativeLinkTarget,
  mergeRootResolutions,
  relativeLinkReference,
  type MarkdownRelativeLinkChoice,
} from "./markdown-relative-link-healing.js";

const WORKSPACE = { hostId: "host_env", rootPath: "/work/ws" };
const STORAGE = { hostId: "host_srv", rootPath: "/srv/thread-storage/thr_a" };
const ROOTS = [WORKSPACE, STORAGE];

describe("relativeLinkReference", () => {
  it.each([
    [
      "coordinator/brief.md",
      "coordinator/brief.md",
      "/work/ws/coordinator/brief.md",
    ],
    ["./src/a.ts:12", "src/a.ts", "/work/ws/src/a.ts"],
  ])("%s resolves against the first root", (href, relativePath, fallback) => {
    const reference = relativeLinkReference(href, ROOTS);
    expect(reference?.relativePath).toBe(relativePath);
    expect(reference?.fallback.link.path).toBe(fallback);
  });

  it.each([
    ["an absolute path", "/etc/hosts"],
    ["a path escaping the root", "../outside.md"],
    ["a URL", "https://example.com/a.md"],
  ])("skips %s", (_, href) => {
    expect(relativeLinkReference(href, ROOTS)).toBeNull();
  });
});

describe("chooseRelativeLinkTarget", () => {
  const reference = relativeLinkReference("src/a.ts:12", ROOTS)!;

  it.each<[string, PathResolution | undefined, MarkdownRelativeLinkChoice]>([
    ["no answer yet", undefined, { kind: "pending" }],
    ["no match", { kind: "matches", paths: [] }, { kind: "missing" }],
    [
      "several suffix matches",
      {
        kind: "matches",
        paths: ["/work/ws/packages/x/src/a.ts", "/work/ws/packages/y/src/a.ts"],
      },
      { kind: "missing" },
    ],
    [
      "an exact path",
      { kind: "exact", path: "/srv/thread-storage/thr_a/src/a.ts" },
      {
        kind: "found",
        href: "file:///srv/thread-storage/thr_a/src/a.ts#L12",
      },
    ],
    [
      "one suffix match",
      { kind: "matches", paths: ["/work/ws/packages/x/src/a.ts"] },
      { kind: "found", href: "file:///work/ws/packages/x/src/a.ts#L12" },
    ],
  ])("%s", (_, resolution, expected) => {
    expect(chooseRelativeLinkTarget(reference, resolution)).toEqual(expected);
  });
});

describe("mergeRootResolutions", () => {
  it("lets an exact path on a later host beat suffix matches on an earlier one", () => {
    expect(
      mergeRootResolutions([
        { kind: "matches", paths: ["/work/ws/deep/brief.md"] },
        { kind: "exact", path: "/srv/thread-storage/thr_a/brief.md" },
      ]),
    ).toEqual({ kind: "exact", path: "/srv/thread-storage/thr_a/brief.md" });
  });

  it("joins suffix matches in root order", () => {
    expect(
      mergeRootResolutions([
        { kind: "matches", paths: ["/work/ws/a/brief.md"] },
        { kind: "matches", paths: ["/srv/thread-storage/thr_a/c/brief.md"] },
      ]),
    ).toEqual({
      kind: "matches",
      paths: ["/work/ws/a/brief.md", "/srv/thread-storage/thr_a/c/brief.md"],
    });
  });
});
