import { describe, expect, it } from "vitest";
import {
  deriveProjectNameFromPath,
  getProjectPathValidationMessage,
  INVALID_PROJECT_PATH_MESSAGE,
  isAbsoluteProjectPath,
  isNativeWindowsProjectPath,
  isSameProjectPath,
  normalizeProjectPathInput,
  PROJECT_PATH_ROOT_MESSAGE,
} from "../src/project-path.js";

describe("project-path posix normalization", () => {
  it.each([
    ["/srv/repos/bb", "/srv/repos/bb"],
    ["/srv/repos/bb/", "/srv/repos/bb"],
    ["/srv/repos/bb///", "/srv/repos/bb"],
    ["/", "/"],
    ["", ""],
    ["   ", ""],
    ["  /srv/repos/bb  ", "/srv/repos/bb"],
    ["relative/path/", "relative/path"],
    ["C:\\Users\\michael\\bb", "C:\\Users\\michael\\bb"],
  ])("normalize(%j, linux) is %j", (input, expected) => {
    expect(normalizeProjectPathInput(input, "linux")).toBe(expected);
  });

  it("treats darwin exactly like linux", () => {
    expect(normalizeProjectPathInput("/srv/repos/bb/", "darwin")).toBe(
      "/srv/repos/bb",
    );
    expect(normalizeProjectPathInput("C:\\bb-test", "darwin")).toBe(
      "C:\\bb-test",
    );
  });
});

describe("project-path win32 drive normalization", () => {
  it.each([
    ["C:\\bb-test", "C:\\bb-test"],
    ["C:/bb-test", "C:\\bb-test"],
    ["c:\\bb-test", "C:\\bb-test"],
    ["c:/bb-test", "C:\\bb-test"],
    ["C:\\bb-test\\", "C:\\bb-test"],
    ["C:/bb-test/", "C:\\bb-test"],
    ["C:\\\\bb-test//sub\\\\dir", "C:\\bb-test\\sub\\dir"],
    ["  C:\\bb-test  ", "C:\\bb-test"],
  ])("normalize(%j, win32) is %j", (input, expected) => {
    expect(normalizeProjectPathInput(input, "win32")).toBe(expected);
  });

  it.each([
    ["C:", "C:\\"],
    ["C:\\", "C:\\"],
    ["c:", "C:\\"],
    ["c:/", "C:\\"],
    ["C:////", "C:\\"],
  ])("collapses drive root %j to C:\\", (input, expected) => {
    expect(normalizeProjectPathInput(input, "win32")).toBe(expected);
  });

  it("makes the degenerate drive root safe to join against", () => {
    const root = normalizeProjectPathInput("C:", "win32");
    expect(root).toBe("C:\\");
    expect(`${root}sub`).toBe("C:\\sub");
    expect(`${normalizeProjectPathInput("C:\\", "win32")}sub`).toBe("C:\\sub");
  });

  it("leaves drive-relative paths alone instead of promoting them", () => {
    expect(normalizeProjectPathInput("C:foo", "win32")).toBe("C:foo");
    expect(normalizeProjectPathInput("C:Users\\michael", "win32")).toBe(
      "C:Users\\michael",
    );
  });
});

describe("project-path win32 UNC normalization", () => {
  it.each([
    ["\\\\server\\share\\proyecto", "\\\\server\\share\\proyecto"],
    ["//server/share/proyecto", "\\\\server\\share\\proyecto"],
    ["\\\\\\\\server\\\\share//proyecto\\", "\\\\server\\share\\proyecto"],
    ["\\\\server\\share", "\\\\server\\share"],
    ["\\\\server\\share\\", "\\\\server\\share"],
  ])("normalize(%j, win32) is %j", (input, expected) => {
    expect(normalizeProjectPathInput(input, "win32")).toBe(expected);
  });
});

describe("project-path win32 extended-length pass-through", () => {
  it.each([
    ["\\\\?\\C:\\ruta\\muy\\larga", "\\\\?\\C:\\ruta\\muy\\larga"],
    ["\\\\?\\C:\\ruta\\muy\\larga\\", "\\\\?\\C:\\ruta\\muy\\larga\\"],
    ["\\\\?\\C:/ruta/muy/larga", "\\\\?\\C:/ruta/muy/larga"],
    [
      "\\\\?\\C:\\Users\\Admin\\Mis proyectos\\diseño",
      "\\\\?\\C:\\Users\\Admin\\Mis proyectos\\diseño",
    ],
  ])("passes %j through untouched", (input, expected) => {
    expect(normalizeProjectPathInput(input, "win32")).toBe(expected);
  });
});

describe("project-path win32 spaces and non-ascii", () => {
  it.each([
    [
      "C:\\Users\\Admin\\Mis proyectos\\diseño",
      "C:\\Users\\Admin\\Mis proyectos\\diseño",
    ],
    [
      "C:/Users/Admin/Mis proyectos/diseño/",
      "C:\\Users\\Admin\\Mis proyectos\\diseño",
    ],
    [
      "C:\\Users\\Admin\\Mis proyectos\\diseño\\",
      "C:\\Users\\Admin\\Mis proyectos\\diseño",
    ],
  ])("normalize(%j, win32) is %j", (input, expected) => {
    expect(normalizeProjectPathInput(input, "win32")).toBe(expected);
  });
});

describe("project-path posix validation", () => {
  it.each(["/srv/repos/bb", "/srv/repos/bb/", "/mnt/c/Users/michael/bb"])(
    "accepts %j as a project path",
    (input) => {
      expect(getProjectPathValidationMessage(input, "linux")).toBeNull();
    },
  );

  it("keeps /mnt/c paths as a compatibility alias, never canonical", () => {
    expect(
      normalizeProjectPathInput("/mnt/c/Users/michael/bb/", "linux"),
    ).toBe("/mnt/c/Users/michael/bb");
    expect(
      normalizeProjectPathInput("/mnt/c/Users/michael/bb", "linux"),
    ).not.toBe("C:\\Users\\michael\\bb");
  });

  it("rejects the filesystem root", () => {
    expect(getProjectPathValidationMessage("/", "linux")).toBe(
      PROJECT_PATH_ROOT_MESSAGE,
    );
  });

  it.each(["", "   ", "relative/path", "C:Users\\michael\\bb"])(
    "rejects %j as not absolute",
    (input) => {
      expect(getProjectPathValidationMessage(input, "linux")).toBe(
        INVALID_PROJECT_PATH_MESSAGE,
      );
    },
  );

  it.each([
    "C:\\bb-test",
    "C:/bb-test",
    "C:\\",
    "C:",
    "\\\\server\\share\\proyecto",
    "\\\\?\\C:\\ruta\\muy\\larga",
  ])("rejects windows-shaped %j on posix as not absolute", (input) => {
    expect(getProjectPathValidationMessage(input, "linux")).toBe(
      INVALID_PROJECT_PATH_MESSAGE,
    );
  });
});

describe("project-path win32 validation", () => {
  it.each([
    "C:\\bb-test",
    "C:/bb-test",
    "c:\\bb-test",
    "C:\\Users\\Admin\\Mis proyectos\\diseño",
    "\\\\server\\share\\proyecto",
    "//server/share/proyecto",
    "\\\\?\\C:\\ruta\\muy\\larga",
  ])("accepts %j as a project path", (input) => {
    expect(getProjectPathValidationMessage(input, "win32")).toBeNull();
  });

  it.each([
    "C:\\",
    "C:",
    "c:",
    "\\\\server\\share",
    "\\\\?\\C:\\",
  ])("rejects root %j as a project directory", (input) => {
    expect(getProjectPathValidationMessage(input, "win32")).toBe(
      PROJECT_PATH_ROOT_MESSAGE,
    );
  });

  it.each([
    "",
    "   ",
    "relative\\path",
    "relative/path",
    "C:foo",
    "C:Users\\michael\\bb",
    "\\solo-raiz",
    "/srv/repos/bb",
    "/",
    "/mnt/c/Users/michael/bb",
    "\\\\server",
    "\\\\?\\",
  ])("rejects %j on win32 as not absolute", (input) => {
    expect(getProjectPathValidationMessage(input, "win32")).toBe(
      INVALID_PROJECT_PATH_MESSAGE,
    );
  });

  it("rejects posix paths on win32 even when they alias windows drives", () => {
    expect(isAbsoluteProjectPath("/mnt/c/Users/michael/bb", "win32")).toBe(
      false,
    );
    expect(
      getProjectPathValidationMessage("/mnt/c/Users/michael/bb", "win32"),
    ).toBe(INVALID_PROJECT_PATH_MESSAGE);
  });
});

describe("project-path deriveProjectNameFromPath", () => {
  it.each([
    ["/srv/repos/bb", "/srv/repos/bb", "linux", "bb"],
    ["/srv/repos/bb/", "/srv/repos/bb", "linux", "bb"],
    ["/mnt/c/Users/michael/bb/", "/mnt/c/Users/michael/bb", "linux", "bb"],
    ["/", "/", "linux", ""],
    ["", "", "linux", ""],
    ["relative/path", "relative/path", "linux", ""],
    ["C:\\bb-test", "C:\\bb-test", "linux", ""],
    ["\\\\server\\share\\proyecto", "\\\\server\\share", "linux", ""],
    ["C:\\bb-test", "C:\\bb-test", "win32", "bb-test"],
    ["C:/bb-test", "C:\\bb-test", "win32", "bb-test"],
    ["c:\\bb-test\\", "C:\\bb-test", "win32", "bb-test"],
    ["C:\\", "C:\\", "win32", ""],
    ["C:", "C:\\", "win32", ""],
    ["\\\\server\\share\\proyecto", "\\\\server\\share\\proyecto", "win32", "proyecto"],
    ["\\\\server\\share", "\\\\server\\share", "win32", ""],
    ["\\\\?\\C:\\ruta\\muy\\larga", "\\\\?\\C:\\ruta\\muy\\larga", "win32", "larga"],
    [
      "C:\\Users\\Admin\\Mis proyectos\\diseño",
      "C:\\Users\\Admin\\Mis proyectos\\diseño",
      "win32",
      "diseño",
    ],
    ["/srv/repos/bb", "/srv/repos/bb", "win32", ""],
  ])(
    "derive(%j on %s) normalizes to %j with name %j",
    (input, _normalized, platform, expected) => {
      expect(
        deriveProjectNameFromPath(
          input,
          platform as ProjectPathPlatform,
        ),
      ).toBe(expected);
    },
  );

  it("does not split posix names on backslashes", () => {
    expect(deriveProjectNameFromPath("/srv/a\\b", "linux")).toBe("a\\b");
  });
});

describe("project-path isAbsoluteProjectPath", () => {
  it.each([
    ["/srv/repos/bb", "linux", true],
    ["/mnt/c/Users/michael/bb", "linux", true],
    ["/", "linux", true],
    ["C:\\Users\\michael\\bb", "linux", false],
    ["C:", "linux", false],
    ["\\\\server\\share\\bb", "linux", false],
    ["relative/path", "linux", false],
    ["", "linux", false],
    ["C:\\bb-test", "win32", true],
    ["C:/bb-test", "win32", true],
    ["c:\\bb-test", "win32", true],
    ["C:", "win32", true],
    ["C:\\", "win32", true],
    ["\\\\server\\share\\proyecto", "win32", true],
    ["//server/share/proyecto", "win32", true],
    ["\\\\?\\C:\\ruta\\muy\\larga", "win32", true],
    ["C:foo", "win32", false],
    ["\\solo-raiz", "win32", false],
    ["/srv/repos/bb", "win32", false],
    ["/", "win32", false],
    ["\\\\server", "win32", false],
    ["\\\\?\\", "win32", false],
    ["relative\\path", "win32", false],
    ["", "win32", false],
  ])("isAbsolute(%j on %s) is %s", (input, platform, expected) => {
    expect(isAbsoluteProjectPath(input, platform as ProjectPathPlatform)).toBe(
      expected,
    );
  });
});

describe("project-path isNativeWindowsProjectPath", () => {
  it.each([
    "C:\\Users\\michael\\bb",
    "C:/Users/michael/bb",
    "C:\\",
    "C:",
    "\\\\server\\share\\bb",
    "\\\\?\\C:\\ruta\\muy\\larga",
  ])("detects %j as a windows-shaped path", (input) => {
    expect(isNativeWindowsProjectPath(input)).toBe(true);
  });

  it.each([
    "/srv/repos/bb",
    "/mnt/c/Users/michael/bb",
    "relative/path",
    "C:Users\\michael\\bb",
    "",
  ])("does not mistake %j for a windows-shaped path", (input) => {
    expect(isNativeWindowsProjectPath(input)).toBe(false);
  });
});

describe("project-path isSameProjectPath", () => {
  it.each([
    ["C:\\bb-test", "C:/bb-test", "win32", true],
    ["C:\\", "C:", "win32", true],
    ["C:\\Foo", "c:\\foo", "win32", true],
    ["C:\\Foo\\Bar", "c:/foo/bar/", "win32", true],
    ["\\\\server\\share\\a", "//server/share/a", "win32", true],
    ["\\\\?\\C:\\Foo", "\\\\?\\c:\\foo", "win32", true],
    ["C:\\a", "C:\\b", "win32", false],
    ["C:\\a", "D:\\a", "win32", false],
    ["C:\\a", "", "win32", false],
    ["", "", "win32", false],
    ["/a/b/", "/a/b", "linux", true],
    ["/mnt/c/x/", "/mnt/c/x", "linux", true],
    ["/Foo", "/foo", "linux", false],
    ["/a", "/b", "linux", false],
    ["", "", "linux", false],
  ])("isSame(%j, %j on %s) is %s", (a, b, platform, expected) => {
    expect(isSameProjectPath(a, b, platform as ProjectPathPlatform)).toBe(
      expected,
    );
  });

  it("folds case only on win32", () => {
    expect(isSameProjectPath("C:\\Foo", "c:\\foo", "win32")).toBe(true);
    expect(isSameProjectPath("C:\\Foo", "c:\\foo", "linux")).toBe(false);
    expect(isSameProjectPath("/Foo", "/foo", "linux")).toBe(false);
  });
});
