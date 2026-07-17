import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createPluginArtifact,
  getInstalledPlugin,
  getPluginArtifactByResolution,
  setPluginArtifactValidation,
  type InstalledPluginRow,
  type PluginExactResolution,
  type PluginProvenance,
  type PluginSourceIntent,
} from "@bb/db";
import { buildPluginApp } from "@bb/plugin-build";
import { validatePluginArtifactMeta } from "./app-bundle.js";
import {
  gitArtifactCacheDir,
  hashInstallDir,
  npmArtifactCacheDir,
  parsePluginSource,
  promoteImmutableDir,
  realPathInside,
  runInstallCommand,
} from "./install-sources.js";
import {
  derivePluginId,
  readPluginManifest,
  type PluginManifest,
} from "./manifest.js";
import type {
  PluginListEntry,
  PluginServiceDeps,
} from "./plugin-service-internal.js";
import {
  createNpmResolverRun,
  evaluateCompatibility,
  resolveGitRef,
  selectNpmCandidate,
  type CompatibilityProblem,
  type GitRefKind,
  type NpmResolvedCandidate,
  type NpmSourceIntentForResolution,
} from "./update-resolver.js";

export interface InstallRegistrationIdentity {
  provenance: PluginProvenance;
  sourceIntent: PluginSourceIntent;
}

export interface RegisterInstalledArgs extends InstallRegistrationIdentity {
  rootDir: string;
  source: string;
  exactResolution: PluginExactResolution;
  refuseEngineMismatch: boolean;
  validated: boolean;
  activeArtifactId?: string;
  preparedManifest?: PluginManifest;
  beforePersist?: () => Promise<void>;
}

export interface InstallContext {
  provenance: PluginProvenance;
}

interface ActivateManagedUpdateArgs {
  row: InstalledPluginRow;
  rootDir: string;
  manifest: PluginManifest;
  source: string;
  sourceIntent: PluginSourceIntent;
  exactResolution: PluginExactResolution;
  artifactId: string;
  beforePersist?: () => Promise<void>;
}

export interface ManagedPluginArtifactsContext {
  deps: PluginServiceDeps;
  withArtifactLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  sourceKind: (source: string) => "path" | "git" | "npm" | "builtin";
  checkEngineRange: (manifest: PluginManifest) => string | undefined;
  checkPluginSdkRange: (manifest: PluginManifest) => string | undefined;
  isPackagedBuiltinAppEntry: (args: {
    kind: "path" | "git" | "npm" | "builtin";
    manifest: PluginManifest;
    rootDir: string;
  }) => boolean;
  registerInstalled: (args: RegisterInstalledArgs) => Promise<PluginListEntry>;
  assertInstallRegistrationAvailable: (
    existing: InstalledPluginRow | undefined,
    identity: InstallRegistrationIdentity,
    pluginId: string,
  ) => void;
  refuseBuiltinShadow: (pluginId: string) => void;
  activateManagedUpdate: (args: ActivateManagedUpdateArgs) => Promise<void>;
}

async function installNpmCandidate(args: {
  stagingPrefix: string;
  registry: string;
  packageName: string;
  candidate: NpmResolvedCandidate;
  notFoundHint: string;
}): Promise<void> {
  await runInstallCommand(
    "npm",
    [
      "install",
      "--prefix",
      args.stagingPrefix,
      "--ignore-scripts",
      "--omit=optional",
      "--no-audit",
      "--no-fund",
      "--registry",
      args.registry,
      `${args.packageName}@${args.candidate.version}`,
    ],
    { notFoundHint: args.notFoundHint },
  );
}

export function createManagedPluginArtifacts(
  context: ManagedPluginArtifactsContext,
) {
  const {
    deps,
    withArtifactLock,
    sourceKind,
    checkEngineRange,
    checkPluginSdkRange,
    isPackagedBuiltinAppEntry,
    registerInstalled,
    assertInstallRegistrationAvailable,
    refuseBuiltinShadow,
    activateManagedUpdate,
  } = context;
  const directInstallContext: InstallContext = {
    provenance: { kind: "direct" },
  };

  /**
   * Validation half of an install: read the manifest, refuse engine
   * mismatches for managed sources (design §6 — install refuses, unlike
   * load which marks `incompatible`), and materialize/verify the frontend
   * bundle. Managed (git:/npm:) installs run this against a staging dir so
   * a failure never touches the currently-installed files.
   */
  async function validateInstallDir(args: {
    rootDir: string;
    source: string;
    refuseEngineMismatch: boolean;
  }): Promise<PluginManifest> {
    const manifest = await readPluginManifest(args.rootDir);
    const kind = sourceKind(args.source);
    const managed = kind === "git" || kind === "npm";
    if (args.refuseEngineMismatch) {
      const engineProblem =
        checkEngineRange(manifest) ?? checkPluginSdkRange(manifest);
      if (engineProblem) {
        throw new Error(
          `install refused: plugin "${manifest.id}" ${engineProblem}`,
        );
      }
    }
    // Frontend policy (design §5.1): path:/git: sources build dist/ at
    // install time — a build failure fails the install, like a manifest
    // error would. npm packages are never built here; they must ship a
    // prebuilt dist whose metadata is compatible with this SDK.
    if (manifest.appEntry !== undefined) {
      if (kind === "npm") {
        const jsPresent = await stat(join(args.rootDir, "dist", "app.js"))
          .then(() => true)
          .catch(() => false);
        if (!jsPresent) {
          throw new Error(
            `install refused: npm plugins with a frontend (bb.app) must publish a prebuilt bundle — "${manifest.id}" is missing dist/app.js + dist/app.meta.json`,
          );
        }
      } else if (
        !isPackagedBuiltinAppEntry({ kind, manifest, rootDir: args.rootDir })
      ) {
        try {
          await buildPluginApp(args.rootDir, deps.appVersion);
        } catch (error) {
          throw new Error(
            `install failed: frontend bundle build for "${manifest.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    async function validateArtifact(
      artifact: "server" | "app",
      required: boolean,
    ): Promise<void> {
      const metaPath = join(args.rootDir, "dist", `${artifact}.meta.json`);
      let raw: string;
      try {
        raw = await readFile(metaPath, "utf8");
      } catch {
        if (required) {
          throw new Error(
            `install refused: ${artifact} artifact for plugin "${manifest.id}" is missing dist/${artifact}.meta.json`,
          );
        }
        return;
      }
      const problem = validatePluginArtifactMeta({
        artifact,
        raw,
        pluginId: manifest.id,
        pluginVersion: manifest.version,
      });
      if (problem !== null) {
        throw new Error(`install refused: ${problem}`);
      }
    }

    if (managed) {
      await validateArtifact("server", false);
      if (manifest.appEntry !== undefined) {
        await validateArtifact("app", kind === "npm");
      }
    }
    return manifest;
  }

  async function readNpmIntegrity(
    prefix: string,
    packageName: string,
  ): Promise<string | null> {
    let value: unknown;
    try {
      value = JSON.parse(
        await readFile(join(prefix, "package-lock.json"), "utf8"),
      );
    } catch {
      return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const lock = value as Record<string, unknown>;
    const packages = lock.packages;
    if (typeof packages === "object" && packages !== null) {
      const entry = (packages as Record<string, unknown>)[
        `node_modules/${packageName}`
      ];
      if (typeof entry === "object" && entry !== null && "integrity" in entry) {
        if (typeof entry.integrity === "string") return entry.integrity;
      }
    }
    const dependencies = lock.dependencies;
    if (typeof dependencies !== "object" || dependencies === null) return null;
    const dependency = (dependencies as Record<string, unknown>)[packageName];
    if (
      typeof dependency !== "object" ||
      dependency === null ||
      !("integrity" in dependency)
    ) {
      return null;
    }
    return typeof dependency.integrity === "string"
      ? dependency.integrity
      : null;
  }

  async function resolveNpmRegistry(
    prefix: string,
    packageName: string,
  ): Promise<string> {
    const scope = packageName.startsWith("@")
      ? packageName.slice(0, packageName.indexOf("/"))
      : null;
    const keys =
      scope === null ? ["registry"] : [`${scope}:registry`, "registry"];
    for (const key of keys) {
      const value = await runInstallCommand("npm", [
        "config",
        "get",
        key,
        "--prefix",
        prefix,
      ]);
      if (value.length > 0 && value !== "undefined" && value !== "null") {
        return value;
      }
    }
    throw new Error(`npm did not resolve a registry for ${packageName}`);
  }

  async function installGitSource(
    parsed: Extract<ReturnType<typeof parsePluginSource>, { kind: "git" }>,
    source: string,
    context: InstallContext = directInstallContext,
  ): Promise<PluginListEntry> {
    const resolution = await resolveGitRef({
      url: parsed.url,
      ref: parsed.ref,
    });
    if (resolution.outcome === "unavailable") {
      throw new Error(`install failed: ${resolution.detail}`);
    }
    const resolvedCommit = resolution.commit;
    const registrationIdentity: InstallRegistrationIdentity = {
      provenance: context.provenance,
      sourceIntent: {
        kind: "git",
        url: parsed.url,
        subdirectory: null,
        requestedRef: parsed.ref,
        refKind: resolution.refKind,
      },
    };
    const targetDir = gitArtifactCacheDir(
      deps.dataDir,
      parsed.cachePath,
      resolvedCommit,
    );
    return withArtifactLock(targetDir, async () => {
      const stagingDir = `${targetDir}.staging`;
      await rm(stagingDir, { recursive: true, force: true });
      const targetRoot = targetDir;
      const cachedRealRoot = await realPathInside(
        targetDir,
        targetRoot,
        "git plugin subdirectory",
      ).catch(() => null);
      const cachedManifest =
        cachedRealRoot === null
          ? null
          : await readPluginManifest(cachedRealRoot).catch(() => null);
      if (cachedManifest !== null) {
        assertInstallRegistrationAvailable(
          getInstalledPlugin(deps.db, cachedManifest.id),
          registrationIdentity,
          cachedManifest.id,
        );
      }
      const existingArtifact =
        cachedManifest === null
          ? undefined
          : getPluginArtifactByResolution(deps.db, {
              sourceKind: "git",
              pluginId: cachedManifest.id,
              path: targetRoot,
              commit: resolvedCommit,
            });
      if (
        (existingArtifact?.validationResult === "valid" ||
          existingArtifact?.validationResult === "pending") &&
        existingArtifact.contentHash !== null
      ) {
        const currentHash = await hashInstallDir(targetDir).catch(() => null);
        if (currentHash === existingArtifact.contentHash) {
          if (existingArtifact.validationResult === "pending") {
            setPluginArtifactValidation(deps.db, existingArtifact.id, {
              contentHash: existingArtifact.contentHash,
              validationResult: "valid",
              validatedAt: Date.now(),
            });
          }
          return registerInstalled({
            rootDir: targetRoot,
            source,
            ...registrationIdentity,
            exactResolution: { kind: "git", commit: resolvedCommit },
            refuseEngineMismatch: true,
            validated: true,
            activeArtifactId: existingArtifact.id,
          });
        }
      }
      await mkdir(dirname(targetDir), { recursive: true });
      const notFoundHint =
        '"git" was not found on PATH — git: plugin installs require git';
      try {
        deps.onArtifactMaterialize?.({ path: targetDir });
        await runInstallCommand(
          "git",
          ["clone", "--quiet", parsed.url, stagingDir],
          { notFoundHint },
        );
        await runInstallCommand("git", [
          "-C",
          stagingDir,
          "checkout",
          "--quiet",
          "--detach",
          resolvedCommit,
        ]);
        const stagedRoot = stagingDir;
        const stagedRealRoot = await realPathInside(
          stagingDir,
          stagedRoot,
          "git plugin subdirectory",
        );
        const stagedManifest = await readPluginManifest(stagedRealRoot);
        assertInstallRegistrationAvailable(
          getInstalledPlugin(deps.db, stagedManifest.id),
          registrationIdentity,
          stagedManifest.id,
        );
        refuseBuiltinShadow(stagedManifest.id);
        const checkedOutCommit = await runInstallCommand("git", [
          "-C",
          stagingDir,
          "rev-parse",
          "HEAD",
        ]);
        if (!checkedOutCommit.startsWith(resolvedCommit)) {
          throw new Error(
            `git resolved ${parsed.ref} to ${resolvedCommit}, but checked out ${checkedOutCommit}`,
          );
        }
        await validateInstallDir({
          rootDir: stagedRealRoot,
          source,
          refuseEngineMismatch: true,
        });
        const contentHash = await hashInstallDir(stagingDir);
        const ownedArtifact =
          existingArtifact ??
          getPluginArtifactByResolution(deps.db, {
            sourceKind: "git",
            pluginId: stagedManifest.id,
            path: targetRoot,
            commit: resolvedCommit,
          });
        const artifact =
          ownedArtifact ??
          createPluginArtifact(deps.db, {
            id: randomUUID(),
            pluginId: stagedManifest.id,
            sourceKind: "git",
            npmResolvedVersion: null,
            gitResolvedCommit: resolvedCommit,
            path: targetRoot,
            integrity: null,
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        if (ownedArtifact !== undefined) {
          setPluginArtifactValidation(deps.db, artifact.id, {
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        }
        return registerInstalled({
          rootDir: targetRoot,
          source,
          ...registrationIdentity,
          exactResolution: { kind: "git", commit: resolvedCommit },
          refuseEngineMismatch: true,
          validated: true,
          activeArtifactId: artifact.id,
          preparedManifest: stagedManifest,
          beforePersist: async () => {
            await promoteImmutableDir({ stagingDir, targetDir, contentHash });
            await deps.afterArtifactPromoted?.({
              pluginId: stagedManifest.id,
              artifactId: artifact.id,
              path: targetRoot,
            });
            if (
              !setPluginArtifactValidation(deps.db, artifact.id, {
                contentHash,
                validationResult: "valid",
                validatedAt: Date.now(),
              })
            ) {
              throw new Error(`plugin artifact disappeared: ${artifact.id}`);
            }
          },
        });
      } catch (error) {
        await rm(stagingDir, { recursive: true, force: true });
        throw error;
      }
      throw new Error("unreachable git install state");
    });
  }

  async function installNpmSource(
    parsed: Extract<ReturnType<typeof parsePluginSource>, { kind: "npm" }>,
    source: string,
    context: InstallContext = directInstallContext,
  ): Promise<PluginListEntry> {
    const registryProbe = join(deps.dataDir, "plugins", "npm", ".registry");
    await mkdir(registryProbe, { recursive: true });
    const registry = await resolveNpmRegistry(registryProbe, parsed.name);
    const intent: NpmSourceIntentForResolution = {
      packageName: parsed.name,
      registry,
      requestedSpec: parsed.spec,
      specKind: parsed.specKind,
    };
    const registrationIdentity: InstallRegistrationIdentity = {
      provenance: context.provenance,
      sourceIntent: { kind: "npm", ...intent },
    };
    const pluginId = derivePluginId(parsed.name);
    assertInstallRegistrationAvailable(
      getInstalledPlugin(deps.db, pluginId),
      registrationIdentity,
      pluginId,
    );
    const selected = await selectNpmCandidate({
      intent,
      appVersion: deps.appVersion,
      run: createNpmResolverRun(),
    });
    if (selected.outcome === "unavailable") {
      throw new Error(`install failed: ${selected.detail}`);
    }
    if (selected.outcome === "incompatible") {
      throw new Error(
        `install refused: ${selected.newest.display} ${selected.reasons.map((problem) => problem.message).join("; ")}`,
      );
    }
    const candidate = selected.candidate;
    const prefix = npmArtifactCacheDir(
      deps.dataDir,
      parsed.name,
      candidate.version,
    );
    const rootDir = join(prefix, "node_modules", ...parsed.name.split("/"));
    return withArtifactLock(prefix, async () => {
      // Materialize + validate in a staging sibling; swap only once good, so
      // a failed refresh keeps the previous (still-loadable) install intact.
      const stagingPrefix = `${prefix}.staging`;
      await rm(stagingPrefix, { recursive: true, force: true });
      const cachedManifest = await readPluginManifest(rootDir).catch(
        () => null,
      );
      const existingArtifact =
        cachedManifest === null
          ? undefined
          : getPluginArtifactByResolution(deps.db, {
              sourceKind: "npm",
              pluginId: cachedManifest.id,
              path: rootDir,
              version: candidate.version,
              integrity: candidate.integrity,
            });
      if (
        (existingArtifact?.validationResult === "valid" ||
          existingArtifact?.validationResult === "pending") &&
        existingArtifact.contentHash !== null
      ) {
        const currentHash = await hashInstallDir(prefix).catch(() => null);
        if (currentHash === existingArtifact.contentHash) {
          if (existingArtifact.validationResult === "pending") {
            setPluginArtifactValidation(deps.db, existingArtifact.id, {
              contentHash: existingArtifact.contentHash,
              validationResult: "valid",
              validatedAt: Date.now(),
            });
          }
          return registerInstalled({
            rootDir,
            source,
            ...registrationIdentity,
            exactResolution: {
              kind: "npm",
              version: candidate.version,
              integrity: candidate.integrity,
            },
            refuseEngineMismatch: true,
            validated: true,
            activeArtifactId: existingArtifact.id,
          });
        }
      }
      await mkdir(stagingPrefix, { recursive: true });
      try {
        deps.onArtifactMaterialize?.({ path: rootDir });
        await installNpmCandidate({
          stagingPrefix,
          registry,
          packageName: parsed.name,
          candidate,
          notFoundHint:
            '"npm" was not found on PATH — npm: plugin installs require npm',
        });
        await validateInstallDir({
          rootDir: join(
            stagingPrefix,
            "node_modules",
            ...parsed.name.split("/"),
          ),
          source,
          refuseEngineMismatch: true,
        });
        const installedIntegrity = await readNpmIntegrity(
          stagingPrefix,
          parsed.name,
        );
        if (
          installedIntegrity !== null &&
          installedIntegrity !== candidate.integrity
        ) {
          throw new Error(
            `install failed: integrity for ${candidate.display} did not match registry metadata`,
          );
        }
        const stagedRoot = join(
          stagingPrefix,
          "node_modules",
          ...parsed.name.split("/"),
        );
        const manifest = await readPluginManifest(stagedRoot);
        const contentHash = await hashInstallDir(stagingPrefix);
        const ownedArtifact =
          existingArtifact ??
          getPluginArtifactByResolution(deps.db, {
            sourceKind: "npm",
            pluginId: manifest.id,
            path: rootDir,
            version: candidate.version,
            integrity: candidate.integrity,
          });
        const artifact =
          ownedArtifact ??
          createPluginArtifact(deps.db, {
            id: randomUUID(),
            pluginId: manifest.id,
            sourceKind: "npm",
            npmResolvedVersion: candidate.version,
            gitResolvedCommit: null,
            path: rootDir,
            integrity: candidate.integrity,
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        if (ownedArtifact !== undefined) {
          setPluginArtifactValidation(deps.db, artifact.id, {
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        }
        return registerInstalled({
          rootDir,
          source,
          ...registrationIdentity,
          exactResolution: {
            kind: "npm",
            version: candidate.version,
            integrity: candidate.integrity,
          },
          refuseEngineMismatch: true,
          validated: true,
          activeArtifactId: artifact.id,
          preparedManifest: manifest,
          beforePersist: async () => {
            await promoteImmutableDir({
              stagingDir: stagingPrefix,
              targetDir: prefix,
              contentHash,
            });
            await deps.afterArtifactPromoted?.({
              pluginId: manifest.id,
              artifactId: artifact.id,
              path: rootDir,
            });
            if (
              !setPluginArtifactValidation(deps.db, artifact.id, {
                contentHash,
                validationResult: "valid",
                validatedAt: Date.now(),
              })
            ) {
              throw new Error(`plugin artifact disappeared: ${artifact.id}`);
            }
          },
        });
      } catch (error) {
        await rm(stagingPrefix, { recursive: true, force: true });
        throw error;
      }
      throw new Error("unreachable npm install state");
    });
  }

  async function stageGitCandidate(args: {
    row: InstalledPluginRow;
    commit: string;
    promote: boolean;
    activationRefKind?: GitRefKind;
    artifactLocked?: boolean;
  }): Promise<
    | {
        outcome: "valid";
        manifest: PluginManifest;
        devMode: boolean;
        packagedBuildProblems: CompatibilityProblem[];
        rootDir: string | null;
        artifactId: string | null;
      }
    | {
        outcome: "incompatible";
        manifest: PluginManifest;
        devMode: boolean;
        reasons: CompatibilityProblem[];
      }
    | { outcome: "invalid"; detail: string }
  > {
    if (args.row.sourceGitUrl === null) {
      throw new Error(
        `plugin "${args.row.id}" has corrupt normalized git state`,
      );
    }
    const cacheSource = parsePluginSource(
      `git:${args.row.sourceGitUrl}@${args.commit}`,
    );
    if (cacheSource.kind !== "git") {
      throw new Error(`plugin "${args.row.id}" has corrupt git source`);
    }
    const targetDir = gitArtifactCacheDir(
      deps.dataDir,
      cacheSource.cachePath,
      args.commit,
    );
    const targetRoot =
      args.row.sourceGitSubdirectory === null
        ? targetDir
        : join(targetDir, args.row.sourceGitSubdirectory);
    if (args.promote && !args.artifactLocked) {
      return withArtifactLock(targetDir, () =>
        stageGitCandidate({ ...args, artifactLocked: true }),
      );
    }
    const existingArtifact = getPluginArtifactByResolution(deps.db, {
      sourceKind: "git",
      pluginId: args.row.id,
      path: targetRoot,
      commit: args.commit,
    });
    if (
      args.promote &&
      (existingArtifact?.validationResult === "valid" ||
        existingArtifact?.validationResult === "pending") &&
      existingArtifact.contentHash !== null &&
      (await hashInstallDir(targetDir).catch(() => null)) ===
        existingArtifact.contentHash
    ) {
      const targetRealRoot = await realPathInside(
        targetDir,
        targetRoot,
        "git plugin subdirectory",
      );
      const manifest = await readPluginManifest(targetRealRoot);
      const compatibility = evaluateCompatibility({
        bbRange: manifest.bbEngineRange,
        sdkRange: manifest.bbPluginSdkRange,
        appVersion: deps.appVersion,
      });
      if (args.activationRefKind === undefined) {
        throw new Error(`plugin "${args.row.id}" update lacks git ref kind`);
      }
      if (args.row.sourceGitRequestedRef === null) {
        throw new Error(`plugin "${args.row.id}" update lacks git intent`);
      }
      if (existingArtifact.validationResult === "pending") {
        setPluginArtifactValidation(deps.db, existingArtifact.id, {
          contentHash: existingArtifact.contentHash,
          validationResult: "valid",
          validatedAt: Date.now(),
        });
      }
      await activateManagedUpdate({
        row: args.row,
        rootDir: targetRoot,
        manifest,
        source: args.row.source,
        sourceIntent: {
          kind: "git",
          url: args.row.sourceGitUrl,
          subdirectory: args.row.sourceGitSubdirectory,
          requestedRef: args.row.sourceGitRequestedRef,
          refKind: args.activationRefKind,
        },
        exactResolution: { kind: "git", commit: args.commit },
        artifactId: existingArtifact.id,
      });
      return {
        outcome: "valid",
        manifest,
        devMode: compatibility.devMode,
        packagedBuildProblems: compatibility.packaged,
        rootDir: targetRoot,
        artifactId: existingArtifact.id,
      };
    }
    const stagingDir = args.promote
      ? `${targetDir}.staging`
      : `${args.row.rootDir}.update-staging-${randomUUID()}`;
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(dirname(stagingDir), { recursive: true });
    try {
      deps.onArtifactMaterialize?.({ path: targetRoot });
      await runInstallCommand(
        "git",
        ["clone", "--quiet", args.row.sourceGitUrl, stagingDir],
        {
          notFoundHint:
            '"git" was not found on PATH — git plugin updates require git',
        },
      );
      await runInstallCommand("git", [
        "-C",
        stagingDir,
        "checkout",
        "--quiet",
        "--detach",
        args.commit,
      ]);
      const pluginRoot =
        args.row.sourceGitSubdirectory === null
          ? stagingDir
          : join(stagingDir, args.row.sourceGitSubdirectory);
      let realPluginRoot: string;
      try {
        realPluginRoot = await realPathInside(
          stagingDir,
          pluginRoot,
          "git plugin subdirectory",
        );
      } catch (error) {
        return {
          outcome: "invalid",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      let manifest: PluginManifest;
      try {
        manifest = await readPluginManifest(realPluginRoot);
      } catch (error) {
        return {
          outcome: "invalid",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      if (manifest.id !== args.row.id) {
        return {
          outcome: "invalid",
          detail: `candidate manifest id changed from "${args.row.id}" to "${manifest.id}"`,
        };
      }
      const compatibility = evaluateCompatibility({
        bbRange: manifest.bbEngineRange,
        sdkRange: manifest.bbPluginSdkRange,
        appVersion: deps.appVersion,
      });
      if (compatibility.effective.length > 0) {
        return {
          outcome: "incompatible",
          manifest,
          devMode: compatibility.devMode,
          reasons: compatibility.effective,
        };
      }
      try {
        await validateInstallDir({
          rootDir: realPluginRoot,
          source: args.row.source,
          refuseEngineMismatch: true,
        });
      } catch (error) {
        return {
          outcome: "invalid",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      let artifactId: string | null = null;
      if (args.promote) {
        if (
          args.activationRefKind === undefined ||
          args.row.sourceGitRequestedRef === null
        ) {
          throw new Error(`plugin "${args.row.id}" update lacks git intent`);
        }
        const contentHash = await hashInstallDir(stagingDir);
        const artifact =
          existingArtifact ??
          createPluginArtifact(deps.db, {
            id: randomUUID(),
            pluginId: args.row.id,
            sourceKind: "git",
            npmResolvedVersion: null,
            gitResolvedCommit: args.commit,
            path: targetRoot,
            integrity: null,
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        if (existingArtifact !== undefined) {
          setPluginArtifactValidation(deps.db, existingArtifact.id, {
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        }
        await activateManagedUpdate({
          row: args.row,
          rootDir: targetRoot,
          manifest,
          source: args.row.source,
          sourceIntent: {
            kind: "git",
            url: args.row.sourceGitUrl,
            subdirectory: args.row.sourceGitSubdirectory,
            requestedRef: args.row.sourceGitRequestedRef,
            refKind: args.activationRefKind,
          },
          exactResolution: { kind: "git", commit: args.commit },
          artifactId: artifact.id,
          beforePersist: async () => {
            await promoteImmutableDir({ stagingDir, targetDir, contentHash });
            await deps.afterArtifactPromoted?.({
              pluginId: args.row.id,
              artifactId: artifact.id,
              path: targetRoot,
            });
            if (
              !setPluginArtifactValidation(deps.db, artifact.id, {
                contentHash,
                validationResult: "valid",
                validatedAt: Date.now(),
              })
            ) {
              throw new Error(`plugin artifact disappeared: ${artifact.id}`);
            }
          },
        });
        artifactId = artifact.id;
      }
      return {
        outcome: "valid",
        manifest,
        devMode: compatibility.devMode,
        packagedBuildProblems: compatibility.packaged,
        rootDir: args.promote ? targetRoot : null,
        artifactId,
      };
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }

  async function applyNpmCandidate(args: {
    row: InstalledPluginRow;
    selectionIntent: NpmSourceIntentForResolution;
    sourceIntent: NpmSourceIntentForResolution;
    candidate: NpmResolvedCandidate;
  }): Promise<void> {
    const targetPrefix = npmArtifactCacheDir(
      deps.dataDir,
      args.selectionIntent.packageName,
      args.candidate.version,
    );
    const targetRoot = join(
      targetPrefix,
      "node_modules",
      ...args.selectionIntent.packageName.split("/"),
    );
    return withArtifactLock(targetPrefix, async () => {
      const existingArtifact = getPluginArtifactByResolution(deps.db, {
        sourceKind: "npm",
        pluginId: args.row.id,
        path: targetRoot,
        version: args.candidate.version,
        integrity: args.candidate.integrity,
      });
      if (
        (existingArtifact?.validationResult === "valid" ||
          existingArtifact?.validationResult === "pending") &&
        existingArtifact.contentHash !== null &&
        (await hashInstallDir(targetPrefix).catch(() => null)) ===
          existingArtifact.contentHash
      ) {
        if (existingArtifact.validationResult === "pending") {
          setPluginArtifactValidation(deps.db, existingArtifact.id, {
            contentHash: existingArtifact.contentHash,
            validationResult: "valid",
            validatedAt: Date.now(),
          });
        }
        const manifest = await readPluginManifest(targetRoot);
        await activateManagedUpdate({
          row: args.row,
          rootDir: targetRoot,
          manifest,
          source:
            args.sourceIntent.specKind === "default"
              ? `npm:${args.sourceIntent.packageName}`
              : `npm:${args.sourceIntent.packageName}@${args.sourceIntent.requestedSpec}`,
          sourceIntent: { kind: "npm", ...args.sourceIntent },
          exactResolution: {
            kind: "npm",
            version: args.candidate.version,
            integrity: args.candidate.integrity,
          },
          artifactId: existingArtifact.id,
        });
        return;
      }
      const stagingPrefix = `${targetPrefix}.staging`;
      await rm(stagingPrefix, { recursive: true, force: true });
      await mkdir(stagingPrefix, { recursive: true });
      try {
        deps.onArtifactMaterialize?.({ path: targetRoot });
        await installNpmCandidate({
          stagingPrefix,
          registry: args.selectionIntent.registry,
          packageName: args.selectionIntent.packageName,
          candidate: args.candidate,
          notFoundHint:
            '"npm" was not found on PATH — npm plugin updates require npm',
        });
        const stagedRoot = join(
          stagingPrefix,
          "node_modules",
          ...args.selectionIntent.packageName.split("/"),
        );
        const manifest = await validateInstallDir({
          rootDir: stagedRoot,
          source: args.row.source,
          refuseEngineMismatch: true,
        });
        if (manifest.id !== args.row.id) {
          throw new Error(
            `update refused: candidate manifest id changed from "${args.row.id}" to "${manifest.id}"`,
          );
        }
        const installedIntegrity = await readNpmIntegrity(
          stagingPrefix,
          args.selectionIntent.packageName,
        );
        if (
          installedIntegrity !== null &&
          installedIntegrity !== args.candidate.integrity
        ) {
          throw new Error(
            `update refused: integrity for ${args.candidate.display} did not match registry metadata`,
          );
        }
        const contentHash = await hashInstallDir(stagingPrefix);
        const artifact =
          existingArtifact ??
          createPluginArtifact(deps.db, {
            id: randomUUID(),
            pluginId: args.row.id,
            sourceKind: "npm",
            npmResolvedVersion: args.candidate.version,
            gitResolvedCommit: null,
            path: targetRoot,
            integrity: args.candidate.integrity,
            contentHash,
            validationResult: "pending",
            validatedAt: null,
          });
        await activateManagedUpdate({
          row: args.row,
          rootDir: targetRoot,
          manifest,
          source:
            args.sourceIntent.specKind === "default"
              ? `npm:${args.sourceIntent.packageName}`
              : `npm:${args.sourceIntent.packageName}@${args.sourceIntent.requestedSpec}`,
          sourceIntent: { kind: "npm", ...args.sourceIntent },
          exactResolution: {
            kind: "npm",
            version: args.candidate.version,
            integrity: args.candidate.integrity,
          },
          artifactId: artifact.id,
          beforePersist: async () => {
            await promoteImmutableDir({
              stagingDir: stagingPrefix,
              targetDir: targetPrefix,
              contentHash,
            });
            await deps.afterArtifactPromoted?.({
              pluginId: args.row.id,
              artifactId: artifact.id,
              path: targetRoot,
            });
            if (
              !setPluginArtifactValidation(deps.db, artifact.id, {
                contentHash,
                validationResult: "valid",
                validatedAt: Date.now(),
              })
            ) {
              throw new Error(`plugin artifact disappeared: ${artifact.id}`);
            }
          },
        });
      } catch (error) {
        await rm(stagingPrefix, { recursive: true, force: true });
        throw error;
      }
    });
  }

  return {
    applyNpmCandidate,
    installGitSource,
    installNpmSource,
    stageGitCandidate,
    validateInstallDir,
  };
}
