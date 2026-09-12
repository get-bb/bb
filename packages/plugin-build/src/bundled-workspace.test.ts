import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

it("keeps bundled stages out of discovery without hiding real plugin packages", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-bundled-workspace-"));
  const graph = () =>
    spawnSync(
      join(repositoryRoot, "node_modules/.bin/turbo"),
      ["run", "build", "--dry=json"],
      { cwd: root, encoding: "utf8", timeout: 15_000 },
    );
  const writePackage = async (directory: string, name: string) => {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(
      join(root, directory, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        scripts: { build: "node -e ''" },
      }),
    );
  };
  const expectPackages = () => {
    const result = graph();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      packages: ["bundled-plugin", "example-plugin"],
    });
  };
  try {
    await cp(
      join(repositoryRoot, "pnpm-workspace.yaml"),
      join(root, "pnpm-workspace.yaml"),
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "workspace-fixture",
        private: true,
        packageManager: "pnpm@9.15.0",
      }),
    );
    await writeFile(
      join(root, "turbo.json"),
      JSON.stringify({ tasks: { build: {} } }),
    );
    await writePackage("plugins/real", "bundled-plugin");
    await writePackage("examples/plugins/real", "example-plugin");
    expectPackages();
    for (const parent of ["plugins", "examples/plugins"]) {
      await cp(
        join(root, parent, "real"),
        join(root, parent, ".bundled-stage-owned"),
        { recursive: true },
      );
    }
    expectPackages();
    for (const parent of ["plugins", "examples/plugins"]) {
      await rm(join(root, parent, ".bundled-stage-owned"), { recursive: true });
    }
    expectPackages();
    await writePackage("plugins/duplicate", "bundled-plugin");
    const duplicate = graph();
    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain("Failed to add workspace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
