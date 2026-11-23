import { describe, expect, it } from "vitest";
import { renderWorkspaceFolderInstructions } from "./workspace-folder-instructions.js";

describe("renderWorkspaceFolderInstructions", () => {
  it("adds nothing for a thread that works in a single folder", () => {
    expect(renderWorkspaceFolderInstructions([], [])).toBeNull();
    expect(
      renderWorkspaceFolderInstructions(
        [{ path: "/work/app", exists: true, isGitRepo: true }],
        [],
      ),
    ).toBeNull();
  });

  it("names each folder with its repository status and marks missing ones", () => {
    expect(
      renderWorkspaceFolderInstructions(
        [
        { path: "/work/app", exists: true, isGitRepo: true },
        { path: "/work/api", exists: true, isGitRepo: true },
        { path: "/data/fixtures", exists: true, isGitRepo: false },
        { path: "/work/gone", exists: false, isGitRepo: false },
        ],
        [],
      ),
    ).toBe(
      [
        "You are working across these folders:",
        "- Main folder (your working directory): /work/app (git repository)",
        "- Additional folder: /work/api (git repository)",
        "- Additional folder: /data/fixtures (not a git repository)",
        "- Additional folder: /work/gone (missing on this machine, so you cannot use it this session)",
        "You can read and write files in every folder listed here that is not missing. Run git commands from inside the repository you mean to change.",
      ].join("\n"),
    );
  });

  it("lists repos found inside a folder under that folder", () => {
    expect(
      renderWorkspaceFolderInstructions(
        [
          { path: "/work/repos", exists: true, isGitRepo: false },
          { path: "/data/stack", exists: true, isGitRepo: false },
        ],
        ["/work/repos/api", "/work/repos/group/web", "/data/stack/infra"],
      ),
    ).toBe(
      [
        "You are working across these folders:",
        "- Main folder (your working directory): /work/repos (not a git repository)",
        "  - Git repository inside it: /work/repos/api",
        "  - Git repository inside it: /work/repos/group/web",
        "- Additional folder: /data/stack (not a git repository)",
        "  - Git repository inside it: /data/stack/infra",
        "You can read and write files in every folder listed here that is not missing. Run git commands from inside the repository you mean to change.",
      ].join("\n"),
    );
    expect(
      renderWorkspaceFolderInstructions(
        [{ path: "/work/repos", exists: true, isGitRepo: false }],
        ["/work/repos/api"],
      ),
    ).toContain("  - Git repository inside it: /work/repos/api");
  });
});
