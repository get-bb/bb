import { describe, expect, it } from "vitest";
import { renderWorkspaceFolderInstructions } from "./workspace-folder-instructions.js";

describe("renderWorkspaceFolderInstructions", () => {
  it("adds nothing for a thread that works in a single folder", () => {
    expect(renderWorkspaceFolderInstructions([])).toBeNull();
    expect(
      renderWorkspaceFolderInstructions([
        { path: "/work/app", isGitRepo: true },
      ]),
    ).toBeNull();
  });

  it("names the main folder and each additional folder with its repository status", () => {
    expect(
      renderWorkspaceFolderInstructions([
        { path: "/work/app", isGitRepo: true },
        { path: "/work/api", isGitRepo: true },
        { path: "/data/fixtures", isGitRepo: false },
      ]),
    ).toBe(
      [
        "You are working across these folders:",
        "- Main folder (your working directory): /work/app (git repository)",
        "- Additional folder: /work/api (git repository)",
        "- Additional folder: /data/fixtures (not a git repository)",
        "You can read and write files in every folder listed here. Run git commands from inside the repository you mean to change.",
      ].join("\n"),
    );
  });
});
