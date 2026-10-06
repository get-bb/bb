import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { isPathWithinDirectory, resolveContainedPath } from "../src/index.js";

it.each(["..cache", "..config", "src"])(
  "accepts the child directory %s without confusing it with parent traversal",
  (name) => {
    const rootPath = join(tmpdir(), "workspace");
    const candidatePath = join(rootPath, name, "file.ts");
    expect(isPathWithinDirectory(rootPath, candidatePath)).toBe(true);
    expect(resolveContainedPath({ rootPath, candidatePath })).toBe(
      candidatePath,
    );
  },
);
