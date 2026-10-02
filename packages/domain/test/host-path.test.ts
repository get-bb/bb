import { describe, expect, it } from "vitest";
import {
  areHostPathsEqual,
  getHostPathBasename,
  getHostPathComparisonKey,
  getHostPathDirname,
  getHostPathFlavor,
  isAbsoluteHostPath,
  isHostPathRoot,
  isHostPathWithin,
  isWindowsUncHostPath,
  joinHostPath,
  normalizeHostPath,
} from "../src/host-path.js";

describe("host-path", () => {
  it("infers the flavor from the path shape", () => {
    expect(getHostPathFlavor("/home/me/repo")).toBe("posix");
    expect(getHostPathFlavor("C:\\src\\repo")).toBe("windows");
    expect(getHostPathFlavor("c:/src/repo")).toBe("windows");
    expect(getHostPathFlavor("C:")).toBe("windows");
    expect(getHostPathFlavor("\\\\server\\share\\repo")).toBe("windows");
    expect(getHostPathFlavor("C:src\\repo")).toBeNull();
    expect(getHostPathFlavor("src/repo")).toBeNull();
    expect(getHostPathFlavor("")).toBeNull();
    expect(isAbsoluteHostPath("C:src")).toBe(false);
    expect(isWindowsUncHostPath("\\\\server\\share")).toBe(true);
    expect(isWindowsUncHostPath("C:\\src")).toBe(false);
  });

  it("normalizes each flavor to a single spelling", () => {
    expect(normalizeHostPath("/home//me/./repo/../repo/")).toBe(
      "/home/me/repo",
    );
    expect(normalizeHostPath("/")).toBe("/");
    expect(normalizeHostPath("c:/src//repo\\.\\x\\..\\")).toBe("C:\\src\\repo");
    expect(normalizeHostPath("C:")).toBe("C:\\");
    expect(normalizeHostPath("C:\\..\\..")).toBe("C:\\");
    expect(normalizeHostPath("//server/share/repo/")).toBe(
      "\\\\server\\share\\repo",
    );
    expect(normalizeHostPath("\\\\server\\share")).toBe("\\\\server\\share\\");
    expect(normalizeHostPath("relative")).toBeNull();
  });

  it("identifies roots", () => {
    expect(isHostPathRoot("/")).toBe(true);
    expect(isHostPathRoot("C:\\")).toBe(true);
    expect(isHostPathRoot("\\\\server\\share\\")).toBe(true);
    expect(isHostPathRoot("C:\\src")).toBe(false);
    expect(isHostPathRoot("relative")).toBe(false);
  });

  it("compares Windows paths without regard to case or separator", () => {
    expect(areHostPathsEqual("C:\\Src\\Repo", "c:/src/repo/")).toBe(true);
    expect(areHostPathsEqual("C:\\src\\repo", "D:\\src\\repo")).toBe(false);
    expect(areHostPathsEqual("/home/me/Repo", "/home/me/repo")).toBe(false);
    expect(areHostPathsEqual("/home/me/repo/", "/home/me/repo")).toBe(true);
    expect(areHostPathsEqual("relative", "relative")).toBe(false);
    expect(getHostPathComparisonKey("C:\\Src\\Repo")).toBe("c:\\src\\repo");
    expect(getHostPathComparisonKey("/Home/Me")).toBe("/Home/Me");
  });

  it("decides containment per flavor", () => {
    expect(
      isHostPathWithin({
        rootPath: "C:\\src\\repo",
        candidatePath: "c:/SRC/repo/packages/x.ts",
      }),
    ).toBe(true);
    expect(
      isHostPathWithin({
        rootPath: "C:\\src\\repo",
        candidatePath: "C:\\src\\repo",
      }),
    ).toBe(true);
    expect(
      isHostPathWithin({
        rootPath: "C:\\src\\repo",
        candidatePath: "C:\\src\\repo-other\\x.ts",
      }),
    ).toBe(false);
    expect(
      isHostPathWithin({
        rootPath: "C:\\src\\repo",
        candidatePath: "C:\\src\\repo\\..\\other",
      }),
    ).toBe(false);
    expect(
      isHostPathWithin({
        rootPath: "C:\\src",
        candidatePath: "D:\\src\\repo",
      }),
    ).toBe(false);
    expect(
      isHostPathWithin({
        rootPath: "/home/me/repo",
        candidatePath: "/home/me/repo/src",
      }),
    ).toBe(true);
    expect(
      isHostPathWithin({
        rootPath: "/home/me/repo",
        candidatePath: "/home/me/Repo/src",
      }),
    ).toBe(false);
    expect(isHostPathWithin({ rootPath: "/", candidatePath: "/etc" })).toBe(
      true,
    );
    expect(
      isHostPathWithin({ rootPath: "/home", candidatePath: "C:\\home" }),
    ).toBe(false);
  });

  it("joins relative paths with the root's separator", () => {
    expect(
      joinHostPath({ rootPath: "C:\\src\\repo", relativePath: "a/b.ts" }),
    ).toBe("C:\\src\\repo\\a\\b.ts");
    expect(joinHostPath({ rootPath: "C:\\", relativePath: "a" })).toBe("C:\\a");
    expect(
      joinHostPath({ rootPath: "/home/me/repo/", relativePath: "a/b.ts" }),
    ).toBe("/home/me/repo/a/b.ts");
    expect(joinHostPath({ rootPath: "/", relativePath: "a" })).toBe("/a");
    expect(joinHostPath({ rootPath: "/home/me", relativePath: "a\\b" })).toBe(
      "/home/me/a\\b",
    );
    expect(
      joinHostPath({ rootPath: "relative", relativePath: "a" }),
    ).toBeNull();
  });

  it("splits directory and base names", () => {
    expect(getHostPathDirname("C:\\src\\repo\\a.ts")).toBe("C:\\src\\repo");
    expect(getHostPathDirname("C:\\src")).toBe("C:\\");
    expect(getHostPathDirname("C:\\")).toBe("C:\\");
    expect(getHostPathDirname("/home/me")).toBe("/home");
    expect(getHostPathDirname("/home")).toBe("/");
    expect(getHostPathBasename("C:\\src\\repo\\")).toBe("repo");
    expect(getHostPathBasename("/home/me/a.ts")).toBe("a.ts");
    expect(getHostPathBasename("/")).toBe("");
  });
});
