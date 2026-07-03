import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection, migrate, type DbConnection } from "@bb/db";
import type { Logger } from "@bb/logger";
import { scaffoldPlugin } from "@bb/templates/plugin-scaffold";
import {
  managedInstallDir,
  parsePluginSource,
} from "../../../src/services/plugins/install-sources.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;
const run = promisify(execFile);

async function hasBinary(command: string): Promise<boolean> {
  try {
    await run(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const [hasGit, hasNpm] = await Promise.all([
  hasBinary("git"),
  hasBinary("npm"),
]);

async function writePluginFixture(
  rootDir: string,
  options: { name: string; version?: string; engines?: string },
): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: options.version ?? "0.1.0",
      ...(options.engines ? { engines: { bb: options.engines } } : {}),
      bb: { server: "./server.ts" },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    `export default function plugin(bb: any) { bb.log.info("loaded"); }`,
  );
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd });
  return stdout.trim();
}

/** Init a commit-able repo with identity config that works anywhere. */
async function initGitRepo(repoDir: string): Promise<void> {
  await git(repoDir, ["init", "-q", "-b", "main"]);
  await git(repoDir, ["config", "user.email", "test@example.com"]);
  await git(repoDir, ["config", "user.name", "Test"]);
}

async function commitAll(repoDir: string, message: string): Promise<string> {
  await git(repoDir, ["add", "-A"]);
  await git(repoDir, ["commit", "-qm", message]);
  return git(repoDir, ["rev-parse", "HEAD"]);
}

describe("plugin install sources", () => {
  it("parses git shorthand, requires a pinned ref, and rejects traversal", () => {
    expect(parsePluginSource("git:github.com/acme/bb-plugin-foo@v1")).toEqual({
      kind: "git",
      url: "https://github.com/acme/bb-plugin-foo",
      ref: "v1",
      installDir: "github.com/acme/bb-plugin-foo@v1",
    });
    expect(
      parsePluginSource("git:https://github.com/acme/bb-plugin-foo.git@abc1234"),
    ).toMatchObject({ kind: "git", url: "https://github.com/acme/bb-plugin-foo.git" });
    expect(() => parsePluginSource("git:github.com/acme/repo")).toThrowError(
      /must pin a ref/,
    );
    // Shorthand/https specs are URL-normalized (".." collapses safely);
    // on-disk paths are not, so traversal there must be rejected.
    expect(parsePluginSource("git:github.com/acme/../evil@v1")).toMatchObject({
      installDir: "github.com/evil@v1",
    });
    expect(() => parsePluginSource("git:/tmp/../evil@v1")).toThrowError(
      /invalid git repository path/,
    );
    expect(() =>
      parsePluginSource("git:github.com/acme/repo@-evil"),
    ).toThrowError(/invalid git ref/);
  });

  it("parses npm specs and refuses ranges and tags", () => {
    expect(parsePluginSource("npm:bb-plugin-linear@0.3.0")).toEqual({
      kind: "npm",
      name: "bb-plugin-linear",
      version: "0.3.0",
    });
    expect(parsePluginSource("npm:@acme/bb-plugin-x@1.2.3")).toEqual({
      kind: "npm",
      name: "@acme/bb-plugin-x",
      version: "1.2.3",
    });
    expect(() => parsePluginSource("npm:bb-plugin-x@^1.0.0")).toThrowError(
      /exact version/,
    );
    expect(() => parsePluginSource("npm:bb-plugin-x@latest")).toThrowError(
      /exact version/,
    );
    expect(() => parsePluginSource("npm:bb-plugin-x")).toThrowError(
      /exact version/,
    );
  });

  it("treats bare strings and path: as local paths with no managed dir", () => {
    expect(parsePluginSource("/tmp/my-plugin")).toEqual({
      kind: "path",
      path: "/tmp/my-plugin",
    });
    expect(parsePluginSource("path:/tmp/my-plugin")).toEqual({
      kind: "path",
      path: "/tmp/my-plugin",
    });
    expect(managedInstallDir("/data", "path:/tmp/my-plugin")).toBeUndefined();
    expect(managedInstallDir("/data", "npm:bb-plugin-x@1.0.0")).toBe(
      "/data/plugins/npm/bb-plugin-x@1.0.0",
    );
  });
});

describe("plugin install flows", () => {
  let db: DbConnection;
  let workDir: string;
  let dataDir: string;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-install-"));
    dataDir = join(workDir, "data");
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir,
      appVersion: "0.9.0",
      isEnabled: () => true,
      loadTimeoutMs: 2000,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  describe.skipIf(!hasGit)("git sources", () => {
    it("clones a pinned tag into the managed dir and loads the plugin", async () => {
      const repoDir = join(workDir, "repo");
      await writePluginFixture(repoDir, { name: "bb-plugin-gitty" });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "init");
      await git(repoDir, ["tag", "v1"]);

      const source = `git:${repoDir}@v1`;
      const entry = await service.install(source);
      expect(entry.id).toBe("gitty");
      expect(entry.status).toBe("running");
      expect(entry.source).toBe(source);
      expect(entry.rootDir).toBe(
        join(dataDir, "plugins", "git", "local", ...repoDir.replace(/^\/+/, "").split("/")) +
          "@v1",
      );
      await stat(join(entry.rootDir, "package.json"));
    });

    it("installs a pinned commit sha via clone + checkout", async () => {
      const repoDir = join(workDir, "repo-sha");
      await writePluginFixture(repoDir, { name: "bb-plugin-shaman" });
      await initGitRepo(repoDir);
      const sha = await commitAll(repoDir, "init");
      // Advance the branch so the sha is not the tip — proves the checkout.
      await writePluginFixture(repoDir, {
        name: "bb-plugin-shaman",
        version: "9.9.9",
      });
      await commitAll(repoDir, "later");

      const entry = await service.install(`git:${repoDir}@${sha}`);
      expect(entry.status).toBe("running");
      expect(entry.version).toBe("0.1.0");
    });

    it("re-installing the same spec refreshes the clone", async () => {
      const repoDir = join(workDir, "repo-refresh");
      await writePluginFixture(repoDir, { name: "bb-plugin-fresh" });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "v0.1.0");
      const source = `git:${repoDir}@main`;
      const first = await service.install(source);
      expect(first.version).toBe("0.1.0");

      await writePluginFixture(repoDir, {
        name: "bb-plugin-fresh",
        version: "0.2.0",
      });
      await commitAll(repoDir, "v0.2.0");
      const second = await service.install(source);
      expect(second.version).toBe("0.2.0");
      expect(second.status).toBe("running");
    });

    it("keeps the previous install intact when a reinstall fails validation", async () => {
      const repoDir = join(workDir, "repo-sturdy");
      await writePluginFixture(repoDir, { name: "bb-plugin-sturdy" });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "v1");
      const source = `git:${repoDir}@main`;
      const first = await service.install(source);
      expect(first.status).toBe("running");

      // The tip now carries a broken manifest: the refresh clone fails
      // validation in its staging dir, so the live install must survive.
      await writeFile(join(repoDir, "package.json"), "{ not json");
      await commitAll(repoDir, "broken manifest");
      await expect(service.install(source)).rejects.toThrowError();

      // The registration still points at real, loadable files.
      await stat(join(first.rootDir, "package.json"));
      await service.reload("sturdy");
      const entry = service.list().find((p) => p.id === "sturdy");
      expect(entry?.status).toBe("running");
      expect(entry?.version).toBe("0.1.0");
    });

    it("hard-fails install on an engines.bb mismatch and cleans up the clone", async () => {
      const repoDir = join(workDir, "repo-too-new");
      await writePluginFixture(repoDir, {
        name: "bb-plugin-too-new",
        engines: ">=99.0.0",
      });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "init");

      const source = `git:${repoDir}@main`;
      await expect(service.install(source)).rejects.toThrowError(
        /install refused.*requires bb >=99\.0\.0/,
      );
      expect(service.list()).toHaveLength(0);
      const managed = managedInstallDir(dataDir, source);
      expect(managed).toBeDefined();
      await expect(stat(managed as string)).rejects.toThrowError();
    });

    it("remove deletes the managed git dir but never a path: dir", async () => {
      const repoDir = join(workDir, "repo-rm");
      await writePluginFixture(repoDir, { name: "bb-plugin-managed" });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "init");
      const managedEntry = await service.install(`git:${repoDir}@main`);

      const pathDir = join(workDir, "local-plugin");
      await writePluginFixture(pathDir, { name: "bb-plugin-localdir" });
      await service.install(pathDir);

      expect(await service.remove("managed")).toBe(true);
      await expect(stat(managedEntry.rootDir)).rejects.toThrowError();
      // The user's original repo is untouched.
      await stat(join(repoDir, "package.json"));

      expect(await service.remove("localdir")).toBe(true);
      await stat(join(pathDir, "package.json"));
    });

    it("refuses a git url without the git binary being asked to run arbitrary flags", async () => {
      await expect(service.install("git:@main")).rejects.toThrowError();
    });
  });

  describe.skipIf(!hasNpm)("npm sources", () => {
    it(
      "installs an exact version from a registry, loads it, and remove deletes the prefix",
      { timeout: 120_000 },
      async () => {
        const name = "bb-plugin-npmhero";
        const version = "0.1.0";
        const fixtureDir = join(workDir, "npm-fixture");
        await writePluginFixture(fixtureDir, { name, version });
        const packDir = join(workDir, "npm-pack");
        await mkdir(packDir, { recursive: true });
        await run("npm", ["pack", "--pack-destination", packDir], {
          cwd: fixtureDir,
        });
        const tarball = await readFile(join(packDir, `${name}-${version}.tgz`));

        // Minimal npm registry over loopback: packument + tarball. Keeps the
        // real `npm install` code path while staying offline.
        const registry = await new Promise<Server>((resolvePromise) => {
          const server = createServer((request, response) => {
            const url = request.url ?? "";
            if (url === `/${name}/-/${name}-${version}.tgz`) {
              response.writeHead(200, { "content-type": "application/octet-stream" });
              response.end(tarball);
              return;
            }
            if (url === `/${name}`) {
              const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
              response.writeHead(200, { "content-type": "application/json" });
              response.end(
                JSON.stringify({
                  name,
                  "dist-tags": { latest: version },
                  versions: {
                    [version]: {
                      name,
                      version,
                      dist: {
                        tarball: `${origin}/${name}/-/${name}-${version}.tgz`,
                        shasum: createHash("sha1").update(tarball).digest("hex"),
                        integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
                      },
                    },
                  },
                }),
              );
              return;
            }
            response.writeHead(404);
            response.end();
          });
          server.listen(0, "127.0.0.1", () => resolvePromise(server));
        });
        const port = (registry.address() as AddressInfo).port;
        const previousRegistry = process.env.npm_config_registry;
        const previousCache = process.env.npm_config_cache;
        process.env.npm_config_registry = `http://127.0.0.1:${port}`;
        process.env.npm_config_cache = join(workDir, "npm-cache");
        try {
          const source = `npm:${name}@${version}`;
          const entry = await service.install(source);
          expect(entry.id).toBe("npmhero");
          expect(entry.status).toBe("running");
          expect(entry.source).toBe(source);
          const prefix = join(dataDir, "plugins", "npm", `${name}@${version}`);
          expect(entry.rootDir).toBe(join(prefix, "node_modules", name));

          expect(await service.remove("npmhero")).toBe(true);
          await expect(stat(prefix)).rejects.toThrowError();
        } finally {
          if (previousRegistry === undefined) {
            delete process.env.npm_config_registry;
          } else {
            process.env.npm_config_registry = previousRegistry;
          }
          if (previousCache === undefined) {
            delete process.env.npm_config_cache;
          } else {
            process.env.npm_config_cache = previousCache;
          }
          await new Promise<void>((resolvePromise) =>
            registry.close(() => resolvePromise()),
          );
        }
      },
    );
  });

  it("the bb plugin new scaffold installs and loads through the plugin service", async () => {
    const targetDir = join(workDir, "bb-plugin-scaffolded");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-scaffolded",
      bbVersion: "0.9.0",
    });
    await stat(join(targetDir, "skills", "example-skill", "SKILL.md"));
    await stat(join(targetDir, ".gitignore"));
    await stat(join(targetDir, "README.md"));

    const entry = await service.install(`path:${targetDir}`);
    expect(entry.id).toBe("scaffolded");
    expect(entry.status).toBe("running");
    expect(entry.statusDetail).toBeNull();

    // Scaffolding refuses to overwrite an existing directory.
    await expect(
      scaffoldPlugin({
        targetDir,
        packageName: "bb-plugin-scaffolded",
        bbVersion: "0.9.0",
      }),
    ).rejects.toThrowError(/already exists/);
  });
});
