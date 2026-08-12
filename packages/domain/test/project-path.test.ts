import { describe, expect, it } from "vitest";
import {
  deriveProjectNameFromPath,
  getProjectPathValidationMessage,
  INVALID_PROJECT_PATH_MESSAGE,
  isAbsoluteProjectPath,
  isNativeWindowsProjectPath,
  normalizeProjectPathInput,
  PROJECT_PATH_ROOT_MESSAGE,
} from "../src/project-path.js";

describe("project-path", () => {
  const windowsProjectPath = "C:\\Users\\michael\\bb";
  const windowsRootPath = "C:\\";
  const uncProjectPath = "\\\\server\\share\\bb";

  it("derives a project name from POSIX paths", () => {
    expect(deriveProjectNameFromPath("/srv/repos/bb")).toBe("bb");
    expect(deriveProjectNameFromPath("/srv/repos/bb/")).toBe("bb");
    expect(deriveProjectNameFromPath("/mnt/c/Users/michael/bb/")).toBe("bb");
  });

  it("derives a project name from native Windows paths", () => {
    expect(deriveProjectNameFromPath(windowsProjectPath)).toBe("bb");
    expect(deriveProjectNameFromPath("C:/Users/michael/bb/")).toBe("bb");
    expect(deriveProjectNameFromPath(uncProjectPath)).toBe("bb");
  });

  it("does not derive a project name from filesystem roots", () => {
    expect(deriveProjectNameFromPath("/")).toBe("");
    expect(deriveProjectNameFromPath(windowsRootPath)).toBe("");
  });

  it("recognizes supported absolute paths", () => {
    expect(isAbsoluteProjectPath("/srv/repos/bb")).toBe(true);
    expect(isAbsoluteProjectPath("/mnt/c/Users/michael/bb")).toBe(true);
    expect(isAbsoluteProjectPath(windowsProjectPath)).toBe(true);
    expect(isAbsoluteProjectPath(uncProjectPath)).toBe(true);
    expect(isAbsoluteProjectPath("C:Users\\michael\\bb")).toBe(false);
    expect(isAbsoluteProjectPath("relative/path")).toBe(false);
  });

  it("recognizes native Windows path flavor", () => {
    expect(isNativeWindowsProjectPath(windowsProjectPath)).toBe(true);
    expect(isNativeWindowsProjectPath("C:/Users/michael/bb")).toBe(true);
    expect(isNativeWindowsProjectPath(uncProjectPath)).toBe(true);
    expect(isNativeWindowsProjectPath(windowsRootPath)).toBe(true);
    expect(isNativeWindowsProjectPath("/mnt/c/Users/michael/bb")).toBe(false);
  });

  it("normalizes trailing separators without collapsing Linux roots", () => {
    expect(normalizeProjectPathInput("/srv/repos/bb/")).toBe("/srv/repos/bb");
    expect(normalizeProjectPathInput("/mnt/c/Users/michael/bb/")).toBe(
      "/mnt/c/Users/michael/bb",
    );
    expect(normalizeProjectPathInput("/")).toBe("/");
    expect(normalizeProjectPathInput(`${windowsProjectPath}\\`)).toBe(
      windowsProjectPath,
    );
  });

  it("returns clear validation messages for path formats", () => {
    expect(getProjectPathValidationMessage("/srv/repos/bb")).toBeNull();
    expect(
      getProjectPathValidationMessage("/mnt/c/Users/michael/bb"),
    ).toBeNull();
    expect(getProjectPathValidationMessage(windowsProjectPath)).toBeNull();
    expect(getProjectPathValidationMessage(uncProjectPath)).toBeNull();
    expect(
      getProjectPathValidationMessage("C:\\Users\\Admin\\projects\\bb"),
    ).toBeNull();
    expect(getProjectPathValidationMessage("/")).toBe(
      PROJECT_PATH_ROOT_MESSAGE,
    );
    expect(getProjectPathValidationMessage(windowsRootPath)).toBe(
      PROJECT_PATH_ROOT_MESSAGE,
    );
    expect(getProjectPathValidationMessage("relative/path")).toBe(
      INVALID_PROJECT_PATH_MESSAGE,
    );
  });
});
