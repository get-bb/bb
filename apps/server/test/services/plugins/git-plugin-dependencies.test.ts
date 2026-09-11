import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installGitDependencies } from "../../../src/services/plugins/git-plugin-dependencies.js";
import { runInstallCommand } from "../../../src/services/plugins/install-sources.js";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "bb-git-dependencies-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(rootDir, { recursive: true, force: true });
});

function manifest(
  dependencies: Record<string, string>,
  devDependencies: Record<string, string> = {},
): string {
  return JSON.stringify(
    {
      name: "bb-plugin-runtime-only",
      version: "1.0.0",
      bb: {
        name: "Runtime only",
        description: "Runtime dependency fixture",
        branding: { icon: "Zap" },
        server: "./server.js",
      },
      dependencies,
      devDependencies,
    },
    null,
    2,
  );
}

it("installs runtime dependencies with development dependencies present and lifecycle scripts disabled", async () => {
  await mkdir(join(rootDir, "runtime"));
  await writeFile(
    join(rootDir, "runtime", "package.json"),
    JSON.stringify({
      name: "runtime-fixture",
      version: "1.0.0",
      scripts: { postinstall: "node -e 'process.exit(42)'" },
    }),
  );
  await runInstallCommand("npm", [
    "pack",
    join(rootDir, "runtime"),
    "--pack-destination",
    rootDir,
    "--ignore-scripts",
  ]);
  await mkdir(join(rootDir, "dev-tool"));
  await writeFile(
    join(rootDir, "dev-tool", "package.json"),
    JSON.stringify({
      name: "dev-tool",
      version: "1.0.0",
    }),
  );
  await runInstallCommand("npm", [
    "pack",
    join(rootDir, "dev-tool"),
    "--pack-destination",
    rootDir,
    "--ignore-scripts",
  ]);
  const devDependencies = {
    "dev-tool": "file:./dev-tool-1.0.0.tgz",
  };
  const dependencies = {
    "runtime-fixture": "file:./runtime-fixture-1.0.0.tgz",
  };
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "bb-plugin-runtime-only",
      version: "1.0.0",
      dependencies,
      devDependencies,
    }),
  );
  await runInstallCommand("npm", [
    "install",
    "--prefix",
    rootDir,
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  const original = manifest(dependencies, devDependencies);
  await writeFile(join(rootDir, "package.json"), original);

  await installGitDependencies(rootDir);

  expect(
    await readFile(
      join(rootDir, "node_modules/runtime-fixture/package.json"),
      "utf8",
    ),
  ).toContain('"version":"1.0.0"');
  expect(await readFile(join(rootDir, "package.json"), "utf8")).toBe(original);
  await expect(
    readFile(join(rootDir, "node_modules/dev-tool/package.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("leaves the source manifest unchanged when a runtime dependency cannot be installed", async () => {
  const original = manifest({
    "missing-runtime": "file:./missing-runtime.tgz",
  });
  await writeFile(join(rootDir, "package.json"), original);

  await expect(installGitDependencies(rootDir)).rejects.toThrow(
    /npm install failed/,
  );

  expect(await readFile(join(rootDir, "package.json"), "utf8")).toBe(original);
  await expect(
    readFile(join(rootDir, "package-lock.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("uses the shipped npm and Node runtime when PATH contains no executables", async () => {
  vi.stubEnv("PATH", rootDir);
  const original = manifest({});
  await writeFile(join(rootDir, "package.json"), original);

  expect(await runInstallCommand("npm", ["--version"])).toBe("11.16.0");
  await installGitDependencies(rootDir);

  expect(await readFile(join(rootDir, "package.json"), "utf8")).toBe(original);
});
