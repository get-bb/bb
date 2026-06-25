import { describe, expect, it } from "vitest";
import { toBreadcrumb } from "./RemotePathBrowser";

describe("toBreadcrumb", () => {
  it("splits a POSIX path into navigable ancestors rooted at /", () => {
    expect(toBreadcrumb("/home/me/project")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "me", path: "/home/me" },
      { label: "project", path: "/home/me/project" },
    ]);
  });

  it("returns just the root for /", () => {
    expect(toBreadcrumb("/")).toEqual([{ label: "/", path: "/" }]);
  });

  it("splits a Windows path rooted at the drive", () => {
    expect(toBreadcrumb("C:\\Users\\me")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "me", path: "C:\\Users\\me" },
    ]);
  });
});
