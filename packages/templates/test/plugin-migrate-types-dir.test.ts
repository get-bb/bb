import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migratePluginToPackageLayout } from "../src/plugin-scaffold.js";

const SDK_VERSION = "0.4.3";

describe("migratePluginToPackageLayout when types/ contains another file", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "bb-plugin-types-dir-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("reports the directory it could not remove and keeps the include", async () => {
    await writeFile(
      join(rootDir, "package.json"),
      `${JSON.stringify(
        {
          name: "bb-plugin-legacy",
          bb: { server: "./server.ts" },
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(rootDir, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            paths: { "@get-bb/plugin-sdk": ["./types/bb-plugin-sdk.d.ts"] },
          },
          include: ["server.ts", "types"],
        },
        null,
        2,
      )}\n`,
    );
    await mkdir(join(rootDir, "types"), { recursive: true });
    await writeFile(join(rootDir, "types", "bb-plugin-sdk.d.ts"), "// old\n");
    await writeFile(join(rootDir, "types", "appeared.d.ts"), "// retained\n");

    const result = await migratePluginToPackageLayout({
      rootDir,
      sdkVersion: SDK_VERSION,
    });

    expect(result.deletedFiles).toEqual(["types/bb-plugin-sdk.d.ts"]);
    expect(result.removedTypesDir).toBe(false);
    expect(
      await stat(join(rootDir, "types")).then((s) => s.isDirectory()),
    ).toBe(true);
    expect(result.removedIncludes).toEqual([]);
    const tsconfig: { include: string[] } = JSON.parse(
      await readFile(join(rootDir, "tsconfig.json"), "utf8"),
    );
    expect(tsconfig.include).toEqual(["server.ts", "types"]);
    const compilerOptions: { paths?: unknown } = JSON.parse(
      await readFile(join(rootDir, "tsconfig.json"), "utf8"),
    ).compilerOptions;
    expect(compilerOptions.paths).toBeUndefined();
  });
});
