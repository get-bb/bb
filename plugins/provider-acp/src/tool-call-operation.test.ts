import { describe, expect, it } from "vitest";
import {
  classifyAcpToolCall,
  resolveAcpFileChangeWriteScope,
} from "./tool-call-operation.js";

describe("classifyAcpToolCall", () => {
  it("treats an other-kind tool with locations as generic, not as a file change", () => {
    expect(
      classifyAcpToolCall({
        kind: "other",
        title: "/tmp/qa-1719",
        locations: [{ path: "/tmp/qa-1719/notes.md" }],
      }),
    ).toEqual({ kind: "generic" });
  });

  it("treats a move-kind tool and a location-free edit as generic", () => {
    expect(
      classifyAcpToolCall({
        kind: "move",
        locations: [{ path: "/tmp/a" }, { path: "/tmp/b" }],
      }),
    ).toEqual({ kind: "generic" });
    expect(classifyAcpToolCall({ kind: "edit", title: "Edit" })).toEqual({
      kind: "generic",
    });
  });

  it("drops blank location paths and falls back to rawInput paths", () => {
    expect(
      classifyAcpToolCall({
        kind: "delete",
        locations: [{ path: "  " }],
        rawInput: { file_path: "/tmp/qa-1719/old.md" },
      }),
    ).toEqual({
      kind: "file_change",
      changeKind: "delete",
      paths: ["/tmp/qa-1719/old.md"],
    });
    expect(
      classifyAcpToolCall({ kind: "edit", locations: [{ path: "" }] }),
    ).toEqual({ kind: "generic" });
  });

  it("classifies diff content as a file change whatever the kind", () => {
    expect(
      classifyAcpToolCall({
        kind: "other",
        content: [{ type: "diff", path: "/tmp/x.md", newText: "hi" }],
      }),
    ).toEqual({
      kind: "file_change",
      changeKind: "update",
      paths: ["/tmp/x.md"],
    });
  });
});

describe("resolveAcpFileChangeWriteScope", () => {
  it("returns the location that contains every other location", () => {
    expect(
      resolveAcpFileChangeWriteScope([
        "/tmp/qa-1719/notes.md",
        "/tmp/qa-1719/",
      ]),
    ).toBe("/tmp/qa-1719");
  });

  it("normalizes .. segments so a path outside the candidate does not pass a raw prefix test", () => {
    expect(
      resolveAcpFileChangeWriteScope(["/repo/../secret/key", "/repo"]),
    ).toBeNull();
    expect(
      resolveAcpFileChangeWriteScope(["/repo/src/../notes.md", "/repo"]),
    ).toBe("/repo");
  });

  it("returns null for paths in different directories and for a lookalike prefix", () => {
    expect(
      resolveAcpFileChangeWriteScope(["/tmp/a/notes.md", "/tmp/b/notes.md"]),
    ).toBeNull();
    expect(
      resolveAcpFileChangeWriteScope(["/tmp/qa-17190/x", "/tmp/qa-1719"]),
    ).toBeNull();
  });

  it("ignores blank paths and never yields an empty scope", () => {
    expect(resolveAcpFileChangeWriteScope(["", "  "])).toBeNull();
    expect(resolveAcpFileChangeWriteScope(["", "/tmp/qa-1719/notes.md"])).toBe(
      "/tmp/qa-1719/notes.md",
    );
  });
});
