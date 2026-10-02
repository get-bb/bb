import { describe, expect, it } from "vitest";
import {
  deriveProjectNameFromPath,
  getProjectPathValidationMessage,
  INVALID_PROJECT_PATH_MESSAGE,
  isAbsoluteProjectPath,
  normalizeProjectPathInput,
  PROJECT_PATH_ROOT_MESSAGE,
  UNSUPPORTED_WINDOWS_NETWORK_PROJECT_PATH_MESSAGE,
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

  it("derives a project name from Windows drive paths", () => {
    expect(deriveProjectNameFromPath(windowsProjectPath)).toBe("bb");
    expect(deriveProjectNameFromPath("C:/Users/michael/bb/")).toBe("bb");
  });

  it("does not derive a project name from network paths or filesystem roots", () => {
    expect(deriveProjectNameFromPath(uncProjectPath)).toBe("");
    expect(deriveProjectNameFromPath("/")).toBe("");
    expect(deriveProjectNameFromPath(windowsRootPath)).toBe("");
    expect(deriveProjectNameFromPath("C:")).toBe("");
  });

  it("recognizes supported absolute paths", () => {
    expect(isAbsoluteProjectPath("/srv/repos/bb")).toBe(true);
    expect(isAbsoluteProjectPath("/mnt/c/Users/michael/bb")).toBe(true);
    expect(isAbsoluteProjectPath(windowsProjectPath)).toBe(true);
    expect(isAbsoluteProjectPath("c:/Users/michael/bb")).toBe(true);
    expect(isAbsoluteProjectPath(uncProjectPath)).toBe(false);
    expect(isAbsoluteProjectPath("C:Users\\michael\\bb")).toBe(false);
    expect(isAbsoluteProjectPath("relative/path")).toBe(false);
  });

  it("normalizes trailing separators without collapsing roots", () => {
    expect(normalizeProjectPathInput("/srv/repos/bb/")).toBe("/srv/repos/bb");
    expect(normalizeProjectPathInput("/mnt/c/Users/michael/bb/")).toBe(
      "/mnt/c/Users/michael/bb",
    );
    expect(normalizeProjectPathInput("/")).toBe("/");
    expect(normalizeProjectPathInput(windowsRootPath)).toBe(windowsRootPath);
  });

  it("stores one spelling for a Windows drive path", () => {
    for (const spelling of [
      windowsProjectPath,
      `${windowsProjectPath}\\`,
      "c:\\Users\\michael\\bb",
      "C:/Users/michael/bb/",
      "C:\\Users\\\\michael\\.\\bb",
    ]) {
      expect(normalizeProjectPathInput(spelling)).toBe(windowsProjectPath);
    }
  });

  it("returns clear validation messages for unsupported path formats", () => {
    expect(getProjectPathValidationMessage("/srv/repos/bb")).toBeNull();
    expect(
      getProjectPathValidationMessage("/mnt/c/Users/michael/bb"),
    ).toBeNull();
    expect(getProjectPathValidationMessage(windowsProjectPath)).toBeNull();
    expect(getProjectPathValidationMessage("/")).toBe(
      PROJECT_PATH_ROOT_MESSAGE,
    );
    expect(getProjectPathValidationMessage(windowsRootPath)).toBe(
      PROJECT_PATH_ROOT_MESSAGE,
    );
    expect(getProjectPathValidationMessage("relative/path")).toBe(
      INVALID_PROJECT_PATH_MESSAGE,
    );
    expect(getProjectPathValidationMessage("C:Users\\michael\\bb")).toBe(
      INVALID_PROJECT_PATH_MESSAGE,
    );
    expect(getProjectPathValidationMessage(uncProjectPath)).toBe(
      UNSUPPORTED_WINDOWS_NETWORK_PROJECT_PATH_MESSAGE,
    );
  });
});
