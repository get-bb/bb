import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findUnscopedPluginNames } from "./scope-plugin-utilities.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

describe("first-party plugin roots", () => {
  it("set the plugin scope attribute wherever they set data-bb-plugin", () => {
    const files = execFileSync(
      "git",
      [
        "ls-files",
        "-z",
        "--",
        "apps/app/src",
        "packages/shared-ui/src",
        "packages/plugin-registry/r",
        "plugins",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    )
      .split("\0")
      .filter(
        (file) =>
          /\.(?:tsx?|json)$/.test(file) &&
          !/\.(?:test|stories)\.tsx?$/.test(file),
      );
    const unscoped = files.flatMap((file) => {
      const source = readFileSync(join(repositoryRoot, file), "utf8");
      return findUnscopedPluginNames(source).map(
        (index) => `${file}: ${source.slice(index, index + 80)}`,
      );
    });
    expect(unscoped).toEqual([]);
  });
});
