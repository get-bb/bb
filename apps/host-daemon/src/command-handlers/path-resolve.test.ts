import fs from "node:fs/promises";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import { resolveHostPaths } from "./path-resolve.js";

async function writeFiles(root: string, files: readonly string[]) {
  for (const file of files) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "x");
  }
}

describe("resolveHostPaths", () => {
  it("prefers an exact path in root order, then a path-suffix match across roots", async () => {
    const base = await makeTempDir("bb-resolve-paths-");
    const workspace = path.join(base, "workspace");
    const storage = path.join(base, "storage");
    await writeFiles(workspace, [
      "README.md",
      "packages/a/src/x.ts",
      "packages/b/lib/x.ts",
      "apps/server/index.ts",
      "apps/app/src/index.ts",
      "node_modules/dep/only-here.ts",
      "src/Widget.tsx",
    ]);
    await writeFiles(storage, ["README.md", "coordinator/brief.md"]);

    const result = await resolveHostPaths({
      type: "host.resolve_paths",
      roots: [workspace, storage],
      paths: [
        "README.md",
        "brief.md",
        "./coordinator/brief.md",
        "src/x.ts",
        "index.ts",
        "widget.tsx",
        "thread.idle",
        "only-here.ts",
        "../workspace/README.md",
      ],
      includeHidden: false,
      respectGitIgnore: true,
      excludeNames: ["node_modules"],
    });

    expect(result.resolutions).toEqual({
      "README.md": { kind: "exact", path: path.join(workspace, "README.md") },
      "brief.md": {
        kind: "matches",
        paths: [path.join(storage, "coordinator/brief.md")],
      },
      "./coordinator/brief.md": {
        kind: "exact",
        path: path.join(storage, "coordinator/brief.md"),
      },
      "src/x.ts": {
        kind: "matches",
        paths: [path.join(workspace, "packages/a/src/x.ts")],
      },
      "index.ts": {
        kind: "matches",
        paths: [
          path.join(workspace, "apps/server/index.ts"),
          path.join(workspace, "apps/app/src/index.ts"),
        ],
      },
      "widget.tsx": {
        kind: "matches",
        paths: [path.join(workspace, "src/Widget.tsx")],
      },
      "thread.idle": { kind: "matches", paths: [] },
      "only-here.ts": { kind: "matches", paths: [] },
      "../workspace/README.md": { kind: "matches", paths: [] },
    });
  });

  it("treats a missing root as empty", async () => {
    const base = await makeTempDir("bb-resolve-paths-missing-");
    await writeFiles(base, ["a/notes.md"]);
    const result = await resolveHostPaths({
      type: "host.resolve_paths",
      roots: [path.join(base, "gone"), base],
      paths: ["notes.md"],
      includeHidden: false,
      respectGitIgnore: true,
      excludeNames: [],
    });
    expect(result.resolutions).toEqual({
      "notes.md": { kind: "matches", paths: [path.join(base, "a/notes.md")] },
    });
  });
});
