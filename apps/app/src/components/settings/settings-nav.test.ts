import { describe, expect, it } from "vitest";
import {
  filterSettingsNavSections,
  resolveSettingsRoute,
} from "./settings-nav";

describe("resolveSettingsRoute", () => {
  it.each([
    {
      pathname: "/settings/providers",
      activeSection: "providers",
      hasUnknownSection: false,
    },
    {
      pathname: "/settings/archived",
      activeSection: "archived",
      hasUnknownSection: false,
    },
    {
      pathname: "/settings/plugins",
      activeSection: "plugins",
      hasUnknownSection: false,
    },
  ])("resolves $pathname", ({ pathname, ...expected }) => {
    expect(resolveSettingsRoute({ pathname, search: "" })).toMatchObject(
      expected,
    );
  });
});

describe("filterSettingsNavSections", () => {
  it.each([
    {
      name: "hides Files without a daemon, helper access or file opener",
      hasDaemon: false,
      accessState: "unavailable",
      fileOpenerCount: 0,
      showsFiles: false,
    },
    {
      name: "shows Files when local helper access can be enabled",
      hasDaemon: false,
      accessState: "permission-required",
      fileOpenerCount: 0,
      showsFiles: true,
    },
  ] as const)("$name", ({ showsFiles, ...input }) => {
    const ids = filterSettingsNavSections(input).map((section) => section.id);
    expect(ids.includes("files")).toBe(showsFiles);
    expect(ids).toContain("archived");
  });
});
