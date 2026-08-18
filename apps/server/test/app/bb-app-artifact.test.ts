import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBbAppArtifactService,
  resolveBbAppPackage,
  type BbAppArtifactCommandRunner,
} from "../../src/services/install/bb-app-artifact.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
// These tests intentionally run real npm/tar child processes. Under a loaded
// workspace test run, process scheduling can exceed Vitest's 5s unit default.
const ARTIFACT_LIFECYCLE_TIMEOUT_MS = 15_000;

// Layouts the server actually runs from. Detection must not depend on
// NODE_ENV: CI's integration harness runs repo sources with a production env.
const MODES = ["repo-src", "repo-dist", "packaged"] as const;
type Mode = (typeof MODES)[number];

function isRepoMode(mode: Mode): boolean {
  return mode !== "packaged";
}

async function fixture(mode: Mode) {
  const root = await mkdtemp(join(tmpdir(), `bb-artifact-${mode}-`));
  roots.push(root);
  const packageRoot = isRepoMode(mode) ? join(root, "packages/bb-app") : root;
  const serverEntry =
    mode === "repo-src"
      ? join(root, "apps/server/src/server.ts")
      : mode === "repo-dist"
        ? join(root, "apps/server/dist/server.js")
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
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe.each(MODES)("bb-app artifact service (%s)", (mode) => {
  it("resolves and packs a structurally valid npm package", async () => {
    const test = await fixture(mode);
    const calls: Array<{
      command: string;
      args: readonly string[];
      cwd: string;
    }> = [];
    const runner: BbAppArtifactCommandRunner = async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      if (command === "pnpm") {
        return "built";
      }
      const result = await execFileAsync(command, [...args], { cwd });
      return result.stdout;
    };
    const resolved = await resolveBbAppPackage(
      pathToFileURL(test.serverEntry).href,
    );
    expect(resolved.root).toBe(test.packageRoot);
    expect(resolved.layout).toBe(isRepoMode(mode) ? "repo" : "packaged");
    const service = createBbAppArtifactService({
      dataDir: join(test.root, "data"),
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
      isRepoMode(mode) ? 1 : 0,
    );
    await expect(service.getTarballPath()).resolves.toBe(tarball);
    expect(calls.filter((call) => call.command === "npm")).toHaveLength(1);
  }, ARTIFACT_LIFECYCLE_TIMEOUT_MS);

  it("rebuilds the artifact after package contents change without a version or protocol change", async () => {
    const test = await fixture(mode);
    const calls: Array<{
      command: string;
      args: readonly string[];
      cwd: string;
    }> = [];
    const runner: BbAppArtifactCommandRunner = async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      if (command === "pnpm") return "built";
      return (await execFileAsync(command, [...args], { cwd })).stdout;
    };
    const options = {
      dataDir: join(test.root, "data"),
      commandRunner: runner,
      serverEntryUrl: pathToFileURL(test.serverEntry).href,
      protocolVersion: 51,
    };

    const first = await createBbAppArtifactService(options).getTarballPath();
    expect(
      (await execFileAsync("tar", ["-xOzf", first, "package/README.md"]))
        .stdout,
    ).toBe("fixture\n");

    await writeFile(join(test.packageRoot, "README.md"), "updated\n");
    const second = await createBbAppArtifactService(options).getTarballPath();

    expect(second).toBe(first);
    expect(
      (await execFileAsync("tar", ["-xOzf", second, "package/README.md"]))
        .stdout,
    ).toBe("updated\n");
    expect(calls.filter((call) => call.command === "npm")).toHaveLength(2);
    expect(calls.filter((call) => call.command === "pnpm")).toHaveLength(
      isRepoMode(mode) ? 2 : 0,
    );
  }, ARTIFACT_LIFECYCLE_TIMEOUT_MS);

  it("builds a fresh artifact when the protocol changes at the same package version", async () => {
    const test = await fixture(mode);
    const calls: Array<{
      command: string;
      args: readonly string[];
      cwd: string;
    }> = [];
    const runner: BbAppArtifactCommandRunner = async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      if (command === "pnpm") return "built";
      return (await execFileAsync(command, [...args], { cwd })).stdout;
    };
    const baseOptions = {
      dataDir: join(test.root, "data"),
      commandRunner: runner,
      serverEntryUrl: pathToFileURL(test.serverEntry).href,
    };

    const first = await createBbAppArtifactService({
      ...baseOptions,
      protocolVersion: 51,
    }).getTarballPath();
    const second = await createBbAppArtifactService({
      ...baseOptions,
      protocolVersion: 52,
    }).getTarballPath();

    expect(second).not.toBe(first);
    expect(calls.filter((call) => call.command === "npm")).toHaveLength(2);
    expect(calls.filter((call) => call.command === "pnpm")).toHaveLength(
      isRepoMode(mode) ? 2 : 0,
    );
  }, ARTIFACT_LIFECYCLE_TIMEOUT_MS);

  it("keeps serving the previous artifact when a rebuild fails, and retries after", async () => {
    const test = await fixture(mode);
    let failNextPack = false;
    const runner: BbAppArtifactCommandRunner = async (command, args, cwd) => {
      if (command === "pnpm") return "built";
      if (failNextPack) throw new Error("npm pack exploded");
      return (await execFileAsync(command, [...args], { cwd })).stdout;
    };
    const options = {
      dataDir: join(test.root, "data"),
      commandRunner: runner,
      serverEntryUrl: pathToFileURL(test.serverEntry).href,
      protocolVersion: 51,
    };

    const tarball = await createBbAppArtifactService(options).getTarballPath();

    // A later process restarts, its rebuild fails, and the artifact it would
    // have replaced must survive: daemons keep an installable package instead
    // of a 404 with nothing on disk.
    failNextPack = true;
    await writeFile(join(test.packageRoot, "README.md"), "updated\n");
    const service = createBbAppArtifactService(options);
    await expect(service.getTarballPath()).rejects.toThrow("npm pack exploded");
    expect(
      (await execFileAsync("tar", ["-xOzf", tarball, "package/README.md"]))
        .stdout,
    ).toBe("fixture\n");

    // The rejection is not memoized, so the next request rebuilds for real.
    failNextPack = false;
    await expect(service.getTarballPath()).resolves.toBe(tarball);
    expect(
      (await execFileAsync("tar", ["-xOzf", tarball, "package/README.md"]))
        .stdout,
    ).toBe("updated\n");
  }, ARTIFACT_LIFECYCLE_TIMEOUT_MS);
});
