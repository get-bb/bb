import { describe, expect, it } from "vitest";
import {
  isPathWithinDirectory,
  resolveManifestPath,
} from "./plugin-manifest.js";

describe("isPathWithinDirectory with win32 paths", () => {
  it("keeps a backslash server entry inside the plugin", () => {
    expect(
      isPathWithinDirectory(
        "D:\\a\\bb-wn\\plugin",
        "D:\\a\\bb-wn\\plugin\\src\\server.ts",
        "win32",
      ),
    ).toBe(true);
  });

  it("accepts forward-slash spellings of the same windows paths", () => {
    expect(
      isPathWithinDirectory(
        "C:/plug",
        "C:/plug/src/server.ts",
        "win32",
      ),
    ).toBe(true);
  });

  it("accepts mixed separators and the root directory itself", () => {
    expect(
      isPathWithinDirectory(
        "D:\\a\\plugin",
        "D:\\a\\plugin/src/server.ts",
        "win32",
      ),
    ).toBe(true);
    expect(
      isPathWithinDirectory("D:\\a\\plugin", "D:\\a\\plugin", "win32"),
    ).toBe(true);
  });

  it("rejects parent traversal outside the plugin", () => {
    expect(
      isPathWithinDirectory("D:\\a\\plugin", "D:\\a\\evil.ts", "win32"),
    ).toBe(false);
    expect(
      isPathWithinDirectory("D:\\a\\plugin", "D:\\other\\x.ts", "win32"),
    ).toBe(false);
  });

  it("rejects a sibling whose prefix matches but is not contained", () => {
    expect(
      isPathWithinDirectory(
        "C:\\plug",
        "C:\\plugin-malo\\x.ts",
        "win32",
      ),
    ).toBe(false);
  });

  it("treats windows paths as case-insensitive", () => {
    expect(
      isPathWithinDirectory(
        "C:\\Plug",
        "c:\\plug\\src\\x.ts",
        "win32",
      ),
    ).toBe(true);
  });

  it("rejects entries on another drive", () => {
    expect(
      isPathWithinDirectory("C:\\plug", "D:\\x.ts", "win32"),
    ).toBe(false);
  });

  it("keeps unc paths inside the share directory", () => {
    expect(
      isPathWithinDirectory(
        "\\\\server\\share\\dir",
        "\\\\server\\share\\dir\\x.ts",
        "win32",
      ),
    ).toBe(true);
    expect(
      isPathWithinDirectory(
        "\\\\server\\share\\dir",
        "\\\\server\\share\\other\\x.ts",
        "win32",
      ),
    ).toBe(false);
  });

  it("allows a file segment that starts with dots without escaping", () => {
    expect(
      isPathWithinDirectory("C:\\p", "C:\\p\\..foo\\x", "win32"),
    ).toBe(true);
  });
});

describe("isPathWithinDirectory with posix paths", () => {
  it("keeps a nested entry inside the plugin", () => {
    expect(
      isPathWithinDirectory(
        "/a/plugin",
        "/a/plugin/src/server.ts",
        "linux",
      ),
    ).toBe(true);
  });

  it("rejects a sibling whose prefix matches but is not contained", () => {
    expect(
      isPathWithinDirectory("/plug", "/plugin-malo/x.ts", "linux"),
    ).toBe(false);
  });

  it("rejects parent traversal", () => {
    expect(isPathWithinDirectory("/a/plugin", "/a/evil.ts", "linux")).toBe(
      false,
    );
  });

  it("treats posix paths as case-sensitive", () => {
    expect(isPathWithinDirectory("/Plug", "/plug/x.ts", "linux")).toBe(false);
  });
});

describe("resolveManifestPath with an injected platform", () => {
  it("resolves a windows server entry inside the plugin", () => {
    expect(
      resolveManifestPath(
        "D:\\a\\bb-wn\\plugin",
        "./src/server.ts",
        "bb.server",
        "win32",
      ),
    ).toBe("D:\\a\\bb-wn\\plugin\\src\\server.ts");
  });

  it("rejects a windows traversal and an absolute windows entry", () => {
    expect(() =>
      resolveManifestPath("D:\\a\\plugin", "../evil.ts", "bb.server", "win32"),
    ).toThrow(/escapes the plugin directory/);
    expect(() =>
      resolveManifestPath(
        "D:\\a\\plugin",
        "C:\\abs.ts",
        "bb.server",
        "win32",
      ),
    ).toThrow(/must be relative/);
  });

  it("keeps resolving posix entries without a platform argument", () => {
    expect(resolveManifestPath("/p", "./s.ts", "bb.server")).toBe("/p/s.ts");
    expect(() => resolveManifestPath("/p", "../e.ts", "bb.server")).toThrow(
      /escapes the plugin directory/,
    );
  });
});
