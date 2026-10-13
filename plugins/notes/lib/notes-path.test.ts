import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTES_DIRECTORY,
  expandHomePath,
  relativeToRoot,
  resolveNotesRoot,
  resolveWithinRoot,
} from "./notes-path.js";

const HOME = "/Users/x";

describe("expandHomePath", () => {
  it("expands a bare tilde", () => {
    expect(expandHomePath("~", HOME)).toBe(HOME);
  });

  it("expands a tilde path", () => {
    expect(expandHomePath("~/Notes", HOME)).toBe("/Users/x/Notes");
  });

  it("leaves an absolute path alone", () => {
    expect(expandHomePath("/srv/notes", HOME)).toBe("/srv/notes");
  });

  it("does not expand a tilde inside a name", () => {
    expect(expandHomePath("notes~backup", HOME)).toBe("notes~backup");
  });
});

describe("resolveNotesRoot", () => {
  it("resolves the shipped default to the home folder", () => {
    expect(
      resolveNotesRoot({
        rawPath: DEFAULT_NOTES_DIRECTORY,
        homeDirectory: HOME,
      }),
    ).toBe("/Users/x/Notes");
  });

  it("accepts an absolute path", () => {
    expect(
      resolveNotesRoot({ rawPath: "/srv/notes", homeDirectory: HOME }),
    ).toBe("/srv/notes");
  });

  it("trims surrounding whitespace", () => {
    expect(
      resolveNotesRoot({ rawPath: "  ~/Vault  ", homeDirectory: HOME }),
    ).toBe("/Users/x/Vault");
  });

  it("drops a trailing separator", () => {
    expect(
      resolveNotesRoot({ rawPath: "/srv/notes/", homeDirectory: HOME }),
    ).toBe("/srv/notes");
  });

  it("refuses a relative path rather than resolving it against the cwd", () => {
    expect(() =>
      resolveNotesRoot({ rawPath: "notes", homeDirectory: HOME }),
    ).toThrow(/absolute path or start with/);
  });

  it("refuses an empty setting", () => {
    expect(() =>
      resolveNotesRoot({ rawPath: "   ", homeDirectory: HOME }),
    ).toThrow(/required/);
  });
});

describe("resolveWithinRoot", () => {
  const root = "/Users/x/Notes";

  it("resolves a nested relative path", () => {
    expect(resolveWithinRoot(root, "work/plan.md")).toBe(
      "/Users/x/Notes/work/plan.md",
    );
  });

  it("refuses a path that climbs out with ..", () => {
    expect(() => resolveWithinRoot(root, "../.ssh/id_rsa")).toThrow(
      /outside the notes folder/,
    );
  });

  it("refuses a climb hidden mid-path", () => {
    expect(() => resolveWithinRoot(root, "work/../../secrets.md")).toThrow(
      /outside the notes folder/,
    );
  });

  it("refuses an absolute path", () => {
    expect(() => resolveWithinRoot(root, "/etc/passwd")).toThrow(
      /must be relative/,
    );
  });

  it("refuses a sibling directory that shares the root's prefix", () => {
    // `/Users/x/Notes-backup` must not pass as a child of `/Users/x/Notes`.
    expect(() => resolveWithinRoot(root, "../Notes-backup/x.md")).toThrow(
      /outside the notes folder/,
    );
  });

  it("allows a path that normalises back inside the root", () => {
    expect(resolveWithinRoot(root, "work/../plan.md")).toBe(
      "/Users/x/Notes/plan.md",
    );
  });

  it("allows the root itself, which the caller checks separately", () => {
    expect(resolveWithinRoot(root, ".")).toBe(root);
  });
});

describe("relativeToRoot", () => {
  it("reports a posix-style relative path", () => {
    expect(relativeToRoot("/Users/x/Notes", "/Users/x/Notes/a/b.md")).toBe(
      "a/b.md",
    );
  });
});
