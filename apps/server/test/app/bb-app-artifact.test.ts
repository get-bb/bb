import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBbAppArtifactService,
  resolveBbAppPackageRoot,
  type BbAppArtifactCommandRunner,
} from "../../src/services/install/bb-app-artifact.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function fixture(mode: "development" | "packaged") {
  const root = await mkdtemp(join(tmpdir(), `bb-artifact-${mode}-`));
  roots.push(root);
  const packageRoot =
    mode === "development" ? join(root, "packages/bb-app") : root;
  const serverEntry =
    mode === "development"
      ? join(root, "apps/server/src/server.ts")
      : join(root, "server/dist/server.js");
  await mkdir(dirname(serverEntry), { recursive: true });
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await writeFile(serverEntry, "// fixture\n");
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "bb-app",
      version: "1.2.3-test",
      files: ["dist", "README.md"],
    }),
  );
  await writeFile(join(packageRoot, "dist/bb-app.js"), "#!/usr/bin/env node\n");
  await writeFile(join(packageRoot, "README.md"), "fixture\n");
  await writeFile(join(packageRoot, "private.txt"), "must not ship\n");
  return { packageRoot, root, serverEntry };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe.each(["development", "packaged"] as const)(
  "bb-app artifact service (%s)",
  (mode) => {
    it("resolves and packs a structurally valid npm package", async () => {
      const test = await fixture(mode);
      const calls: Array<{ command: string; args: readonly string[]; cwd: string }> = [];
      const runner: BbAppArtifactCommandRunner = async (command, args, cwd) => {
        calls.push({ command, args, cwd });
        if (command === "pnpm") {
          return "built";
        }
        const result = await execFileAsync(command, [...args], { cwd });
        return result.stdout;
      };
      expect(
        resolveBbAppPackageRoot({
          isDevelopment: mode === "development",
          serverEntryUrl: pathToFileURL(test.serverEntry).href,
        }),
      ).toBe(test.packageRoot);
      const service = createBbAppArtifactService({
        dataDir: join(test.root, "data"),
        isDevelopment: mode === "development",
        commandRunner: runner,
        serverEntryUrl: pathToFileURL(test.serverEntry).href,
      });

      const tarball = await service.getTarballPath();
      await expect(service.getVersion()).resolves.toBe("1.2.3-test");
      const listing = (
        await execFileAsync("tar", ["-tzf", tarball])
      ).stdout.split("\n");
      expect(listing).toContain("package/package.json");
      expect(listing).toContain("package/dist/bb-app.js");
      expect(listing).toContain("package/README.md");
      expect(listing).not.toContain("package/private.txt");
      const packageJson = JSON.parse(
        (await execFileAsync("tar", ["-xOzf", tarball, "package/package.json"]))
          .stdout,
      );
      expect(packageJson.version).toBe("1.2.3-test");
      expect(calls.filter((call) => call.command === "pnpm")).toHaveLength(
        mode === "development" ? 1 : 0,
      );
      await expect(service.getTarballPath()).resolves.toBe(tarball);
      expect(calls.filter((call) => call.command === "npm")).toHaveLength(1);
    });
  },
);
