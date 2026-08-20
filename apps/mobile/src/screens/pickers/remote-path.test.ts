import { describe, expect, it } from "vitest";
import {
  getFolderNameValidationMessage,
  joinHostPath,
  toBreadcrumb,
} from "./remote-path";

describe("remote path helpers", () => {
  it("builds POSIX and Windows breadcrumbs with the root first", () => {
    expect(toBreadcrumb("/Users/me/repo")).toEqual([
      { label: "/", path: "/" },
      { label: "Users", path: "/Users" },
      { label: "me", path: "/Users/me" },
      { label: "repo", path: "/Users/me/repo" },
    ]);
    expect(toBreadcrumb("/")).toEqual([{ label: "/", path: "/" }]);
    expect(toBreadcrumb("C:\\Users\\me")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "me", path: "C:\\Users\\me" },
    ]);
  });

  it("joins with the host's separator and rejects unsafe folder names", () => {
    expect(joinHostPath("/Users/me/", "repo")).toBe("/Users/me/repo");
    expect(joinHostPath("C:\\Users\\me\\", "repo")).toBe("C:\\Users\\me\\repo");
    expect(getFolderNameValidationMessage("")).toMatch(/Enter/);
    expect(getFolderNameValidationMessage("..")).toMatch(/Enter/);
    expect(getFolderNameValidationMessage("a/b")).toMatch(/slashes/);
    expect(getFolderNameValidationMessage("repo")).toBeNull();
  });
});
