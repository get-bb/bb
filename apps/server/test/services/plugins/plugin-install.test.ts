import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  getInstalledPluginRegistration,
  listPluginArtifacts,
  migrate,
  type DbConnection,
} from "@bb/db";
import type { Logger } from "@bb/logger";
import { scaffoldPlugin } from "@bb/templates/plugin-scaffold";
import { PLUGIN_SDK_MAJOR, PLUGIN_SDK_VERSION } from "@bb/domain";
import { validatePluginArtifactMeta } from "../../../src/services/plugins/app-bundle.js";
import {
  gitArtifactCacheDir,
  npmArtifactCacheDir,
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
  options: {
    name: string;
    version?: string;
    engines?: string;
    pluginSdkRange?: string;
    appSource?: string;
  },
): Promise<void> {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: options.version ?? "0.1.0",
      ...(options.engines || options.pluginSdkRange
        ? {
            engines: {
              ...(options.engines ? { bb: options.engines } : {}),
              ...(options.pluginSdkRange
                ? { bbPluginSdk: options.pluginSdkRange }
                : {}),
            },
          }
        : {}),
      bb: {
        name: "Install fixture",
        description: "Plugin installation fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        ...(options.appSource === undefined ? {} : { app: "./app.tsx" }),
      },
    }),
  );
  await writeFile(
    join(rootDir, "server.ts"),
    `export default function plugin(bb: any) { bb.log.info("loaded"); }`,
  );
  if (options.appSource !== undefined) {
    await writeFile(join(rootDir, "app.tsx"), options.appSource);
  }
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

function artifactMeta(args: {
  artifactFormatVersion?: number;
  pluginId: string;
  pluginVersion?: string;
  sdkMajor?: number;
  sdkVersion?: string;
}): string {
  const sdkMajor = args.sdkMajor ?? PLUGIN_SDK_MAJOR;
  const sdkVersion = args.sdkVersion ?? PLUGIN_SDK_VERSION;
  return JSON.stringify({
    sdkMajor,
    sdkVersion,
    artifactFormatVersion: args.artifactFormatVersion ?? 1,
    pluginId: args.pluginId,
    pluginVersion: args.pluginVersion ?? "0.1.0",
    builtWith: {
      bbVersion: "0.9.0-test",
      pluginSdkVersion: sdkVersion,
    },
  });
}

describe("plugin install sources", () => {
  it("parses git URLs, tracks HEAD by default, and rejects traversal", () => {
    expect(parsePluginSource("git:github.com/acme/bb-plugin-foo@v1")).toEqual({
      kind: "git",
      url: "https://github.com/acme/bb-plugin-foo",
      ref: "v1",
      installDir: "github.com/acme/bb-plugin-foo@v1",
      cachePath: "github.com/acme/bb-plugin-foo",
    });
    expect(
      parsePluginSource(
        "git:https://github.com/acme/bb-plugin-foo.git@abc1234",
      ),
    ).toMatchObject({
      kind: "git",
      url: "https://github.com/acme/bb-plugin-foo.git",
    });
    expect(parsePluginSource("https://github.com/acme/bb-plugin-foo")).toEqual({
      kind: "git",
      url: "https://github.com/acme/bb-plugin-foo",
      ref: "HEAD",
      installDir: "github.com/acme/bb-plugin-foo@HEAD",
      cachePath: "github.com/acme/bb-plugin-foo",
    });
    expect(
      parsePluginSource("https://github.com/acme/bb-plugin-foo/"),
    ).toMatchObject({
      kind: "git",
      ref: "HEAD",
      cachePath: "github.com/acme/bb-plugin-foo",
    });
    expect(parsePluginSource("git:github.com/acme/repo")).toMatchObject({
      kind: "git",
      ref: "HEAD",
    });
    expect(() => parsePluginSource("git:github.com/acme/repo@")).toThrowError(
      /empty ref/,
    );
    expect(() =>
      parsePluginSource("git:github.com/acme/../evil@v1"),
    ).toThrowError(/invalid git repository path/);
    expect(() => parsePluginSource("git:/tmp/../evil@v1")).toThrowError(
      /invalid git repository path/,
    );
    expect(() =>
      parsePluginSource("git:github.com/acme/repo@-evil"),
    ).toThrowError(/invalid git ref/);
  });

  it("classifies omitted, exact, range, and dist-tag npm specs", () => {
    expect(parsePluginSource("npm:bb-plugin-linear@0.3.0")).toEqual({
      kind: "npm",
      name: "bb-plugin-linear",
      spec: "0.3.0",
      specKind: "exact",
    });
    expect(parsePluginSource("npm:@acme/bb-plugin-x@1.2.3")).toEqual({
      kind: "npm",
      name: "@acme/bb-plugin-x",
      spec: "1.2.3",
      specKind: "exact",
    });
    expect(parsePluginSource("npm:bb-plugin-x@^1.0.0")).toMatchObject({
      spec: "^1.0.0",
      specKind: "range",
    });
    expect(parsePluginSource("npm:bb-plugin-x@next")).toMatchObject({
      spec: "next",
      specKind: "tag",
    });
    expect(parsePluginSource("npm:bb-plugin-x")).toMatchObject({
      spec: "",
      specKind: "default",
    });
    expect(parsePluginSource("npm:@acme/bb-plugin-x")).toMatchObject({
      name: "@acme/bb-plugin-x",
      spec: "",
      specKind: "default",
    });
  });

  it("treats bare non-URL strings and path: as local paths with no managed dir", () => {
    expect(parsePluginSource("/tmp/my-plugin")).toEqual({
      kind: "path",
      path: "/tmp/my-plugin",
    });
    expect(parsePluginSource("path:/tmp/my-plugin")).toEqual({
      kind: "path",
      path: "/tmp/my-plugin",
    });
  });

  it("keeps scoped npm and nested git cache paths inside their roots", () => {
    expect(npmArtifactCacheDir("/data", "@acme/plugin", "1.2.3")).toBe(
      "/data/plugins/cache/npm/@acme/plugin/1.2.3",
    );
    expect(
      gitArtifactCacheDir(
        "/data",
        "github.com/acme/nested/plugin",
        "abcdef1234567",
      ),
    ).toBe(
      "/data/plugins/cache/git/github.com/acme/nested/plugin/abcdef1234567",
    );
    expect(() => npmArtifactCacheDir("/data", "../plugin", "1.2.3")).toThrow(
      /invalid npm package/,
    );
    expect(() =>
      gitArtifactCacheDir("/data", "github.com/acme/../evil", "abcdef1"),
    ).toThrow(/invalid git artifact/);
  });
});

describe("plugin install flows", () => {
  let db: DbConnection;
  let workDir: string;
  let dataDir: string;
  let service: PluginService;
  let afterArtifactPromoted:
    | ((args: {
        pluginId: string;
        artifactId: string;
        path: string;
      }) => Promise<void>)
    | undefined;
  let materializationCount: number;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "bb-plugin-install-"));
    dataDir = join(workDir, "data");
    afterArtifactPromoted = undefined;
    materializationCount = 0;
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
      loadTimeoutMs: 2000,
      afterArtifactPromoted: async (args) => afterArtifactPromoted?.(args),
      onArtifactMaterialize: () => {
        materializationCount += 1;
      },
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  // Each test clones a repo and runs a full install (git subprocesses +
  // esbuild build + plugin load); the 5s default flakes on loaded CI runners.
  describe.skipIf(!hasGit)("git sources", { timeout: 30_000 }, () => {
    it("installs and tracks the default branch when the ref is omitted", async () => {
      const repoDir = join(workDir, "repo-default-branch");
      await writePluginFixture(repoDir, { name: "bb-plugin-default-branch" });
      await initGitRepo(repoDir);
      const commit = await commitAll(repoDir, "init");

      const source = `git:${repoDir}`;
      const entry = await service.install(source);

      expect(entry).toMatchObject({
        id: "default-branch",
        source,
        status: "running",
      });
      expect(
        getInstalledPluginRegistration(db, "default-branch"),
      ).toMatchObject({
        sourceKind: "git",
        sourceGitUrl: repoDir,
        sourceGitRequestedRef: "HEAD",
        sourceGitRefKind: "branch",
        gitResolvedCommit: commit,
      });
    });

    it("clones a pinned tag into its exact immutable cache dir and loads it", async () => {
      const repoDir = join(workDir, "repo");
      await writePluginFixture(repoDir, { name: "bb-plugin-gitty" });
      await initGitRepo(repoDir);
      const commit = await commitAll(repoDir, "init");
      await git(repoDir, ["tag", "v1"]);

      const source = `git:${repoDir}@v1`;
      const entry = await service.install(source);
      expect(entry.id).toBe("gitty");
      expect(entry.status).toBe("running");
      expect(entry.source).toBe(source);
      expect(entry.rootDir).toBe(
        join(
          dataDir,
          "plugins",
          "cache",
          "git",
          "local",
          ...repoDir.replace(/^\/+/, "").split("/"),
          commit,
        ),
      );
      await stat(join(entry.rootDir, "package.json"));
      expect(getInstalledPluginRegistration(db, "gitty")).toMatchObject({
        provenance: "direct",
        sourceKind: "git",
        sourceGitUrl: repoDir,
        sourceGitRequestedRef: "v1",
        gitResolvedCommit: expect.stringMatching(/^[0-9a-f]{40}$/),
        activeArtifactId: expect.any(String),
      });
    });

    it("refuses a git plugin that shadows a builtin after materialization", async () => {
      const repoDir = join(workDir, "repo-connect");
      await writePluginFixture(repoDir, { name: "bb-plugin-connect" });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "init");

      await expect(service.install(`git:${repoDir}@main`)).rejects.toThrowError(
        /reserved by the bundled plugin.*builtin:connect/,
      );
      expect(getInstalledPluginRegistration(db, "connect")).toBeUndefined();
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

    it("never reuses an exact-resolution artifact owned by another plugin", async () => {
      const repoDir = join(workDir, "repo-owner");
      await writePluginFixture(repoDir, { name: "bb-plugin-owner" });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "init");
      await git(repoDir, ["tag", "v1"]);
      const source = `git:${repoDir}@v1`;
      await service.install(source);
      const original = listPluginArtifacts(db, "owner")[0];
      if (original === undefined) throw new Error("missing owner artifact");
      await service.remove("owner");
      db.$client
        .prepare("UPDATE plugin_artifacts SET plugin_id = ? WHERE id = ?")
        .run("different-plugin", original.id);

      const reinstalled = await service.install(source);
      const activeId = getInstalledPluginRegistration(
        db,
        "owner",
      )?.activeArtifactId;
      expect(activeId).not.toBe(original.id);
      expect(reinstalled.status).toBe("running");
      expect(listPluginArtifacts(db, "owner")).toMatchObject([
        { id: activeId, pluginId: "owner", validationResult: "valid" },
      ]);
    });

    it("serializes concurrent installs of the same exact resolution", async () => {
      const repoDir = join(workDir, "repo-concurrent");
      await writePluginFixture(repoDir, { name: "bb-plugin-concurrent" });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "init");
      await git(repoDir, ["tag", "v1"]);
      const source = `git:${repoDir}@v1`;

      const results = await Promise.allSettled([
        service.install(source),
        service.install(source),
      ]);
      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "fulfilled" }),
          expect.objectContaining({
            status: "rejected",
            reason: expect.objectContaining({
              message: expect.stringContaining("bb plugin update concurrent"),
            }),
          }),
        ]),
      );
      expect(materializationCount).toBe(1);
      expect(listPluginArtifacts(db, "concurrent")).toHaveLength(1);
    });

    it("refuses a managed reinstall and points to the update command", async () => {
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
      await expect(service.install(source)).rejects.toThrow(
        "bb plugin update fresh",
      );
      expect(
        service.list().find((plugin) => plugin.id === "fresh"),
      ).toMatchObject({ version: "0.1.0", status: "running" });
    });

    it("refuses a managed frontend reinstall before validating a broken new tip or creating an artifact", async () => {
      const repoDir = join(workDir, "repo-managed-frontend");
      await writePluginFixture(repoDir, {
        name: "bb-plugin-managed-frontend",
        appSource:
          'export default function App() { return <div className="line-clamp-2">working</div>; }\n',
      });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "working frontend");
      const source = `git:${repoDir}@main`;
      const first = await service.install(source);
      expect(first).toMatchObject({
        id: "managed-frontend",
        version: "0.1.0",
        status: "running",
      });
      const registrationBefore = getInstalledPluginRegistration(
        db,
        "managed-frontend",
      );
      const artifactsBefore = listPluginArtifacts(db, "managed-frontend");
      expect(artifactsBefore).toHaveLength(1);

      await writePluginFixture(repoDir, {
        name: "bb-plugin-managed-frontend",
        version: "0.2.0",
        appSource: "export default function App( {\n",
      });
      await commitAll(repoDir, "broken frontend");

      await expect(service.install(source)).rejects.toThrow(
        "bb plugin update managed-frontend",
      );
      expect(getInstalledPluginRegistration(db, "managed-frontend")).toEqual(
        registrationBefore,
      );
      expect(listPluginArtifacts(db, "managed-frontend")).toEqual(
        artifactsBefore,
      );
      expect(
        service.list().find((plugin) => plugin.id === "managed-frontend"),
      ).toMatchObject({ version: "0.1.0", status: "running" });
    }, 120_000);

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

    // bb now builds a git plugin's server bundle itself, so a committed
    // dist/ is not authoritative for git the way it is for npm: whatever the
    // author checked in is replaced by a bundle built against this SDK.
    // `validatePluginArtifactMeta` still guards npm artifacts; it is covered
    // directly in "plugin artifact metadata validation" below.
    it("rebuilds a git plugin's server bundle over any committed dist", async () => {
      const identityRepo = join(workDir, "repo-artifact-identity");
      await writePluginFixture(identityRepo, {
        name: "bb-plugin-artifact-identity",
      });
      await mkdir(join(identityRepo, "dist"), { recursive: true });
      await writeFile(
        join(identityRepo, "dist", "server.meta.json"),
        artifactMeta({ pluginId: "wrong-plugin-id" }),
      );
      await initGitRepo(identityRepo);
      await commitAll(identityRepo, "mismatched artifact identity");

      const entry = await service.install(`git:${identityRepo}@main`);
      expect(entry.status).toBe("running");
      const meta: unknown = JSON.parse(
        await readFile(
          join(entry.rootDir, "dist", "server.meta.json"),
          "utf8",
        ),
      );
      expect(meta).toMatchObject({
        pluginId: "artifact-identity",
        sdkVersion: PLUGIN_SDK_VERSION,
        artifactFormatVersion: 1,
      });
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
      const managed = join(
        dataDir,
        "plugins",
        "git",
        "local",
        ...repoDir.replace(/^\/+/, "").split("/"),
      );
      await expect(stat(`${managed}@main`)).rejects.toThrowError();
    });

    it("hard-fails managed install on an engines.bbPluginSdk mismatch", async () => {
      const repoDir = join(workDir, "repo-sdk-too-new");
      await writePluginFixture(repoDir, {
        name: "bb-plugin-sdk-too-new",
        pluginSdkRange: ">=99.0.0",
      });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "init");

      await expect(service.install(`git:${repoDir}@main`)).rejects.toThrowError(
        new RegExp(
          `install refused.*requires bb plugin SDK >=99\\.0\\.0, running SDK is ${PLUGIN_SDK_VERSION.replaceAll(".", "\\.")}`,
        ),
      );
    });

    it("remove retains immutable git artifacts and never touches a path source", async () => {
      const repoDir = join(workDir, "repo-rm");
      await writePluginFixture(repoDir, { name: "bb-plugin-managed" });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "init");
      const managedEntry = await service.install(`git:${repoDir}@main`);

      const pathDir = join(workDir, "local-plugin");
      await writePluginFixture(pathDir, { name: "bb-plugin-localdir" });
      await service.install(pathDir);

      expect(await service.remove("managed")).toBe(true);
      await stat(managedEntry.rootDir);
      // The user's original repo is untouched.
      await stat(join(repoDir, "package.json"));

      expect(await service.remove("localdir")).toBe(true);
      await stat(join(pathDir, "package.json"));
    });

    it("refuses a git url without the git binary being asked to run arbitrary flags", async () => {
      await expect(service.install("git:@main")).rejects.toThrowError();
    });

    it("builds both bundles for a git plugin", async () => {
      const repoDir = join(workDir, "repo-selfcontained");
      await writePluginFixture(repoDir, { name: "bb-plugin-selfcontained" });
      await initGitRepo(repoDir);
      await commitAll(repoDir, "init");

      const entry = await service.install(`git:${repoDir}@main`);
      expect(entry.status).toBe("running");
      // Built here rather than committed, so the loader prefers a bundle
      // stamped for this exact SDK over the TypeScript source.
      await stat(join(entry.rootDir, "dist", "server.js"));
      await stat(join(entry.rootDir, "dist", "server.meta.json"));
    });

    it("ignores a repository .npmrc when installing dependencies", async () => {
      const repoDir = join(workDir, "repo-npmrc");
      await writePluginFixture(repoDir, { name: "bb-plugin-npmrc" });
      // `npm --prefix <clone>` reads this file. An author could redirect the
      // registry, relax TLS, or interpolate ${ENV} into request URLs, so it
      // must not survive into the install.
      await writeFile(
        join(repoDir, ".npmrc"),
        "registry=http://127.0.0.1:1/evil\nstrict-ssl=false\n",
      );
      await initGitRepo(repoDir);
      await commitAll(repoDir, "init");

      const entry = await service.install(`git:${repoDir}@main`);

      expect(entry.status).toBe("running");
      await expect(stat(join(entry.rootDir, ".npmrc"))).rejects.toThrowError();
    });

    it.runIf(hasNpm)(
      "inlines a git plugin's third-party dependency into its bundles",
      async () => {
        const depDir = join(workDir, "dep-package");
        await mkdir(depDir, { recursive: true });
        await writeFile(
          join(depDir, "package.json"),
          JSON.stringify({
            name: "bb-test-greeter",
            version: "1.0.0",
            main: "index.js",
          }),
        );
        await writeFile(
          join(depDir, "index.js"),
          "module.exports.greet = () => 'hello from the dependency';",
        );

        const repoDir = join(workDir, "repo-with-deps");
        await writePluginFixture(repoDir, { name: "bb-plugin-withdeps" });
        const manifestPath = join(repoDir, "package.json");
        const manifest: unknown = JSON.parse(
          await readFile(manifestPath, "utf8"),
        );
        await writeFile(
          manifestPath,
          JSON.stringify({
            ...(manifest as Record<string, unknown>),
            dependencies: { "bb-test-greeter": `file:${depDir}` },
          }),
        );
        await writeFile(
          join(repoDir, "server.ts"),
          `import { greet } from "bb-test-greeter";\n` +
            `export default function plugin(bb: any) { bb.log.info(greet()); }`,
        );
        await initGitRepo(repoDir);
        await commitAll(repoDir, "init");

        const entry = await service.install(`git:${repoDir}@main`);
        expect(entry.status).toBe("running");
        const bundle = await readFile(
          join(entry.rootDir, "dist", "server.js"),
          "utf8",
        );
        expect(bundle).toContain("hello from the dependency");
        // node_modules is retained: esbuild only bundles statically reachable
        // code, so a dependency's runtime data files must survive.
        await stat(join(entry.rootDir, "node_modules"));
      },
    );
  });

  describe("plugin artifact metadata validation", () => {
    // Guards npm artifacts, which bb never builds. Covered directly because
    // git installs now overwrite any committed dist/ metadata.
    it("rejects an artifact whose pluginId does not match the manifest", () => {
      expect(
        validatePluginArtifactMeta({
          artifact: "server",
          raw: artifactMeta({ pluginId: "wrong-plugin-id" }),
          pluginId: "artifact-identity",
          pluginVersion: "0.1.0",
        }),
      ).toMatch(
        /server artifact pluginId "wrong-plugin-id" does not match manifest pluginId "artifact-identity"/,
      );
    });

    it("rejects an unknown artifactFormatVersion", () => {
      expect(
        validatePluginArtifactMeta({
          artifact: "server",
          raw: artifactMeta({
            artifactFormatVersion: 2,
            pluginId: "artifact-format",
          }),
          pluginId: "artifact-format",
          pluginVersion: "0.1.0",
        }),
      ).toMatch(/unknown artifactFormatVersion 2.*supported value is 1/);
    });

    it("accepts metadata that matches the manifest and this SDK", () => {
      expect(
        validatePluginArtifactMeta({
          artifact: "server",
          raw: artifactMeta({ pluginId: "artifact-ok" }),
          pluginId: "artifact-ok",
          pluginVersion: "0.1.0",
        }),
      ).toBeNull();
    });
  });

  it("keeps path installs developer-friendly while surfacing SDK incompatibility", async () => {
    const rootDir = join(workDir, "local-sdk-mismatch");
    await writePluginFixture(rootDir, {
      name: "bb-plugin-local-sdk-mismatch",
      pluginSdkRange: ">=99.0.0",
    });

    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("incompatible");
    expect(entry.statusDetail).toContain(
      `requires bb plugin SDK >=99.0.0, running SDK is ${PLUGIN_SDK_VERSION}`,
    );
  });

  it("registers a path install with stale backend artifact metadata", async () => {
    const rootDir = join(workDir, "local-stale-server-meta");
    const incompatibleMajor = PLUGIN_SDK_MAJOR + 1;
    await writePluginFixture(rootDir, {
      name: "bb-plugin-local-stale-server-meta",
    });
    await mkdir(join(rootDir, "dist"), { recursive: true });
    await writeFile(
      join(rootDir, "dist", "server.meta.json"),
      artifactMeta({
        pluginId: "local-stale-server-meta",
        sdkMajor: incompatibleMajor,
        sdkVersion: `${incompatibleMajor}.0.0`,
      }),
    );

    const entry = await service.installPath(rootDir);
    expect(entry).toMatchObject({
      id: "local-stale-server-meta",
      status: "running",
      statusDetail: null,
    });
  });

  describe.skipIf(!hasNpm)("npm sources", () => {
    it(
      "installs a scoped package into the immutable cache and retains it on removal",
      { timeout: 120_000 },
      async () => {
        const name = "@acme/bb-plugin-npmhero";
        const version = "0.1.0";
        const fixtureDir = join(workDir, "npm-fixture");
        await writePluginFixture(fixtureDir, { name, version });
        const packDir = join(workDir, "npm-pack");
        await mkdir(packDir, { recursive: true });
        await run("npm", ["pack", "--pack-destination", packDir], {
          cwd: fixtureDir,
        });
        const [tarballName] = await readdir(packDir);
        if (tarballName === undefined)
          throw new Error("npm pack produced no tarball");
        const tarball = await readFile(join(packDir, tarballName));
        let tarballRequests = 0;

        // Minimal npm registry over loopback: packument + tarball. Keeps the
        // real `npm install` code path while staying offline.
        const registry = await new Promise<Server>((resolvePromise) => {
          const server = createServer((request, response) => {
            const url = request.url ?? "";
            if (url === "/package.tgz") {
              tarballRequests += 1;
              response.writeHead(200, {
                "content-type": "application/octet-stream",
              });
              response.end(tarball);
              return;
            }
            if (decodeURIComponent(url) === `/${name}`) {
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
                        tarball: `${origin}/package.tgz`,
                        shasum: createHash("sha1")
                          .update(tarball)
                          .digest("hex"),
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
        const previousCache = process.env.npm_config_cache;
        const previousPackageLock = process.env.npm_config_package_lock;
        const previousUserConfig = process.env.NPM_CONFIG_USERCONFIG;
        const userConfig = join(workDir, "npmrc");
        await writeFile(
          userConfig,
          `@acme:registry=http://127.0.0.1:${port}\nregistry=https://registry.npmjs.org\n`,
        );
        process.env.NPM_CONFIG_USERCONFIG = userConfig;
        process.env.npm_config_cache = join(workDir, "npm-cache");
        process.env.npm_config_package_lock = "false";
        try {
          const source = `npm:${name}@${version}`;
          const entry = await service.install(source);
          expect(tarballRequests).toBe(1);
          expect(entry.id).toBe("npmhero");
          expect(entry.status).toBe("running");
          expect(entry.source).toBe(source);
          const prefix = join(
            dataDir,
            "plugins",
            "cache",
            "npm",
            ...name.split("/"),
            version,
          );
          expect(entry.rootDir).toBe(join(prefix, "node_modules", name));
          await expect(
            stat(join(prefix, "package-lock.json")),
          ).rejects.toThrow();
          expect(getInstalledPluginRegistration(db, "npmhero")).toMatchObject({
            provenance: "direct",
            sourceKind: "npm",
            sourceNpmPackage: name,
            sourceNpmRegistry: `http://127.0.0.1:${port}`,
            sourceNpmRequestedSpec: version,
            sourceNpmSpecKind: "exact",
            npmResolvedVersion: version,
            npmIntegrity: expect.stringMatching(/^sha512-/),
            activeArtifactId: expect.any(String),
          });

          await expect(service.applyUpdate("npmhero")).resolves.toMatchObject({
            ok: false,
            error: expect.stringContaining("pinned by its source intent"),
          });
          expect(tarballRequests).toBe(1);
          expect(getInstalledPluginRegistration(db, "npmhero")).toMatchObject({
            source,
            sourceNpmRequestedSpec: version,
            sourceNpmSpecKind: "exact",
            rootDir: join(prefix, "node_modules", name),
          });
          await stat(prefix);

          expect(await service.remove("npmhero")).toBe(true);
          await stat(prefix);
          expect(listPluginArtifacts(db, "npmhero")).toHaveLength(1);
        } finally {
          if (previousCache === undefined) {
            delete process.env.npm_config_cache;
          } else {
            process.env.npm_config_cache = previousCache;
          }
          if (previousPackageLock === undefined) {
            delete process.env.npm_config_package_lock;
          } else {
            process.env.npm_config_package_lock = previousPackageLock;
          }
          if (previousUserConfig === undefined) {
            delete process.env.NPM_CONFIG_USERCONFIG;
          } else {
            process.env.NPM_CONFIG_USERCONFIG = previousUserConfig;
          }
          await new Promise<void>((resolvePromise) =>
            registry.close(() => resolvePromise()),
          );
        }
      },
    );
  });

  it("refuses an npm package whose derived id shadows a builtin before install", async () => {
    await expect(
      service.install("npm:bb-plugin-connect@1.2.3"),
    ).rejects.toThrowError(/reserved by the bundled plugin.*builtin:connect/);
    expect(getInstalledPluginRegistration(db, "connect")).toBeUndefined();
  });

  it("refuses a path plugin whose manifest id shadows a builtin", async () => {
    const rootDir = join(workDir, "bb-plugin-connect");
    await writePluginFixture(rootDir, { name: "bb-plugin-connect" });
    await expect(service.installPath(rootDir)).rejects.toThrowError(
      /reserved by the bundled plugin.*builtin:connect/,
    );
    expect(getInstalledPluginRegistration(db, "connect")).toBeUndefined();
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
