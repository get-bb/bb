import { describe, expect, it } from "vitest";
import { relativizeWorkspacePathFork } from "../src/relativize-workspace-path.fork.js";

describe("relativizeWorkspacePathFork", () => {
  it("relativizes a forward-slash path against a backslash Windows root", () => {
    expect(
      relativizeWorkspacePathFork(
        "C:/!Pavl0/GitHub/pzayash/bb/src/a.ts",
        "C:\\!Pavl0\\GitHub\\pzayash\\bb",
      ),
    ).toBe("src/a.ts");
  });

  it("relativizes a backslash path against a forward-slash Windows root", () => {
    expect(relativizeWorkspacePathFork("C:\\repo\\src\\a.ts", "C:/repo")).toBe(
      "src/a.ts",
    );
  });

  it("matches a Windows root case-insensitively", () => {
    expect(relativizeWorkspacePathFork("c:/REPO/src/a.ts", "C:\\repo")).toBe(
      "src/a.ts",
    );
  });

  it("relativizes the file directly under the root", () => {
    expect(
      relativizeWorkspacePathFork("C:/repo/change-log-demo.md", "C:\\repo"),
    ).toBe("change-log-demo.md");
  });

  it("keeps the POSIX behavior case-sensitive", () => {
    expect(
      relativizeWorkspacePathFork("/home/User/a.ts", "/home/user"),
    ).toBeNull();
    expect(relativizeWorkspacePathFork("/home/user/a.ts", "/home/user")).toBe(
      "a.ts",
    );
  });

  it("returns null for a path outside the workspace root", () => {
    expect(relativizeWorkspacePathFork("/etc/hosts", "/home/user")).toBeNull();
    expect(relativizeWorkspacePathFork("D:/other/a.ts", "C:\\repo")).toBeNull();
  });

  it("returns null without a workspace root or with a root-only path", () => {
    expect(relativizeWorkspacePathFork("C:/repo/a.ts", null)).toBeNull();
    expect(relativizeWorkspacePathFork("/home/user/a.ts", "/")).toBeNull();
  });
});
