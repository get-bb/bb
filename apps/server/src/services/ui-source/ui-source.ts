import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SystemChangeKind } from "@bb/domain";

/**
 * The "UI source" feature: a user-editable copy of the frontend that the server
 * can build and serve in place of the shipped UI, live-reloading every client.
 *
 * Layout (all under the data dir):
 *   <dataDir>/ui/            git repo: the editable checkout (src/, index.html,
 *                            public/, node_modules -> apps/app/node_modules)
 *   <dataDir>/ui/dist/       the promoted build the server serves when active
 *   <dataDir>/ui/.dist-stage temporary build output (promoted on success)
 *   <dataDir>/ui-state.json  which source is active + last build status
 *
 * The build reuses apps/app's toolchain via apps/app/vite.ui.config.ts (see that
 * file). Recovery lives out of band: a server-injected shim plus the CLI/server
 * revert, so a broken build never traps the user.
 */

export type UiSourceActive = "prod" | "fork";
export type UiSourceStatus =
  | "idle"
  | "building"
  | "ready"
  | "error"
  | "needs-rebase";

export interface UiSourceState {
  active: UiSourceActive;
  status: UiSourceStatus;
  seeded: boolean;
  lastBuiltAt: string | null;
  error: string | null;
  /** App version the current shipped baseline was seeded/updated from. */
  version: string | null;
  /** Files with unresolved conflicts after a failed `update` rebase. */
  conflictFiles: string[];
}

export type UiUpdateMode = "start" | "continue" | "abort";

export interface UiUpdateResult {
  ok: boolean;
  state: UiSourceState;
  /** True when there was no newer shipped source to rebase onto. */
  upToDate?: boolean;
  /** Conflicted files when the rebase needs manual resolution. */
  conflictFiles?: string[];
  error?: string;
}

export interface UiSourceApplyResult {
  ok: boolean;
  state: UiSourceState;
  /** Build log tail, present on failure so an agent can fix and retry. */
  log?: string;
  error?: string;
  /**
   * Type errors from a scoped `tsc --noEmit` over the UI source, when present.
   * Advisory only — the build still serves (Vite strips types); this is feedback
   * so an agent can fix type mistakes the build won't catch.
   */
  typeErrors?: string;
}

interface UiSourceLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

interface UiSourceHub {
  notifySystem(changes: SystemChangeKind[]): void;
}

export interface UiSourceDeps {
  dataDir: string;
  /**
   * Directory holding the shipped app source (src/index.html/public/
   * package.json + vite.ui.config.ts). In a source checkout this is apps/app; in
   * a packaged install it is the shipped, self-contained ui-source-seed.
   */
  appDir: string;
  /**
   * Directory holding the @bb/* workspace packages as source. Defaults to
   * `<appDir>/../../packages` (the repo layout); the packaged seed passes
   * `<seed>/packages`.
   */
  packagesSourceDir?: string;
  hub: UiSourceHub;
  logger: UiSourceLogger;
  /** Current shipped app version, recorded on the UI-source baseline. */
  version?: string;
  /**
   * Whether the UI-forking experiment is on. When false, the `bb ui` mutations
   * are rejected and the shipped UI is always served. Defaults to enabled.
   */
  isEnabled?: () => boolean;
  /** Inject a fixed timestamp in tests; defaults to Date.now wall clock. */
  now?: () => string;
  /**
   * Override the build step (tests inject a fake that writes the staged dist
   * instead of running Vite). Production uses the default Vite build.
   */
  buildRunner?: (ctx: {
    uiDir: string;
    stageDir: string;
    appDir: string;
  }) => Promise<{ ok: boolean; log: string }>;
  /**
   * Override the workspace prepare step (vendor packages + write workspace files
   * + pnpm install). Tests inject a no-op so they don't run a real install.
   */
  prepareWorkspace?: () => Promise<{ ok: boolean; log: string }>;
  /**
   * Ensure the shipped source (appDir/packagesSourceDir) is present before
   * seeding. For a packaged install with no surrounding repo this clones the
   * matching release tag; in a source checkout it is absent (source is present).
   */
  ensureSource?: () => Promise<{ ok: boolean; log: string }>;
}

/** Kill a UI-source build that hangs so `apply` cannot block forever. */
const BUILD_TIMEOUT_MS = 5 * 60_000;
/** Cap `pnpm install` so a stuck install cannot wedge `apply`. */
const INSTALL_TIMEOUT_MS = 10 * 60_000;

const DEFAULT_STATE: UiSourceState = {
  active: "prod",
  status: "idle",
  seeded: false,
  lastBuiltAt: null,
  error: null,
  version: null,
  conflictFiles: [],
};

export interface UiSourceService {
  getState(): UiSourceState;
  /** Absolute path of the editable fork workspace (edit src/, package.json here). */
  getSourceDir(): string;
  /** Whether the UI-forking experiment is on. */
  isEnabled(): boolean;
  /** Directory to serve right now: the fork's dist when active+built, else shipped. */
  resolveActiveRoot(shippedDir: string): string;
  /**
   * Create the editable fork and switch to it. First run seeds it (clone or
   * assemble + install + build); `reset` discards edits and re-seeds; otherwise
   * a re-run just switches back to the fork.
   */
  fork(opts?: { reset?: boolean }): Promise<UiSourceApplyResult>;
  /** Rebuild the fork after edits (requires an existing fork). */
  apply(): Promise<UiSourceApplyResult>;
  /** Switch back to the shipped (production) UI; the fork stays on disk. */
  prod(): Promise<UiSourceState>;
  /**
   * Reconcile fork edits with a newer shipped UI by rebasing them onto the new
   * shipped baseline. "start" attempts the rebase (clean -> rebuild+serve;
   * conflict -> fall back to prod + needs-rebase). "continue"/"abort" finish a
   * conflicted rebase after an agent resolves or gives up.
   */
  update(mode: UiUpdateMode): Promise<UiUpdateResult>;
}

export function createUiSourceService(deps: UiSourceDeps): UiSourceService {
  // Canonicalize so the Vite build root has no symlink in its path (e.g. macOS
  // /tmp -> /private/tmp, or a symlinked data dir). rolldown rejects emitted
  // asset paths that escape the root, which a symlinked root triggers.
  const dataDir = existsSync(deps.dataDir)
    ? realpathSync(deps.dataDir)
    : deps.dataDir;
  const appDir = existsSync(deps.appDir)
    ? realpathSync(deps.appDir)
    : deps.appDir;
  const uiDir = join(dataDir, "ui");
  const distDir = join(uiDir, "dist");
  const stageDir = join(uiDir, ".dist-stage");
  const statePath = join(dataDir, "ui-state.json");
  const now = deps.now ?? (() => new Date().toISOString());
  const isEnabled = deps.isEnabled ?? (() => true);

  let state = loadState();

  function loadState(): UiSourceState {
    try {
      if (existsSync(statePath)) {
        const raw = JSON.parse(
          readFileSync(statePath, "utf8"),
        ) as Partial<UiSourceState>;
        const loaded: UiSourceState = {
          ...DEFAULT_STATE,
          ...raw,
          seeded: existsSync(join(uiDir, "index.html")),
        };
        // No build can be in flight at construction, so a persisted "building"
        // means a prior process crashed mid-build. Don't report it forever.
        if (loaded.status === "building") {
          loaded.status = loaded.lastBuiltAt ? "ready" : "idle";
        }
        return loaded;
      }
    } catch (error) {
      deps.logger.warn({ err: error }, "Failed to read ui-state.json; defaulting");
    }
    return { ...DEFAULT_STATE, seeded: existsSync(join(uiDir, "index.html")) };
  }

  async function writeState(next: Partial<UiSourceState>): Promise<void> {
    state = { ...state, ...next };
    await mkdir(dataDir, { recursive: true });
    await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
  }

  // Commit identity passed per-invocation so updates don't depend on the user's
  // global git config.
  const GIT_IDENTITY = [
    "-c",
    "user.email=bb@local",
    "-c",
    "user.name=bb ui",
  ];

  function runGit(
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolvePromise) => {
      // Force non-interactive editors so `rebase --continue` (which would open
      // $GIT_EDITOR to confirm the replayed commit message) reuses the message
      // instead of hanging on a headless server.
      const child = spawn("git", args, {
        cwd: uiDir,
        env: {
          ...process.env,
          GIT_EDITOR: "true",
          GIT_SEQUENCE_EDITOR: "true",
          GIT_TERMINAL_PROMPT: "0",
        },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c: Buffer) => {
        stdout += c.toString();
      });
      child.stderr.on("data", (c: Buffer) => {
        stderr += c.toString();
      });
      child.on("error", (e) =>
        resolvePromise({ code: 1, stdout, stderr: stderr + String(e) }),
      );
      child.on("close", (code) =>
        resolvePromise({ code: code ?? 1, stdout, stderr }),
      );
    });
  }

  const packagesDir =
    deps.packagesSourceDir ?? resolve(appDir, "..", "..", "packages");
  const installMarkerPath = join(uiDir, ".bb-installed");

  // Never copy build artifacts or installed deps into the UI source.
  function copyExclude(src: string): boolean {
    return !/[/\\](node_modules|dist|\.dist-stage|\.git)([/\\]|$)/.test(src);
  }

  // Lay down the shipped app source (the whole apps/app tree minus build output
  // and installed deps) into a target. Used to seed and to refresh the shipped
  // baseline on update. Per-entry so an existing tree is updated in place.
  // Generated/ignored top-level entries we manage — never treat as orphans.
  const MANAGED_ENTRIES = new Set([
    "node_modules",
    "dist",
    ".dist-stage",
    ".git",
    "packages",
    ".bb-installed",
    "pnpm-workspace.yaml",
    ".npmrc",
    "pnpm-lock.yaml",
    ".gitignore",
  ]);

  async function copyAppSource(target: string): Promise<void> {
    const appEntries = new Set(readdirSync(appDir));
    // Remove top-level files/dirs deleted upstream so the baseline doesn't keep
    // orphans (but never the generated/ignored entries we manage).
    if (existsSync(target)) {
      for (const entry of readdirSync(target)) {
        if (!appEntries.has(entry) && !MANAGED_ENTRIES.has(entry)) {
          await rm(join(target, entry), { recursive: true, force: true });
        }
      }
    }
    for (const entry of readdirSync(appDir)) {
      // Skip build output and the vendored packages/ (handled by vendorPackages
      // from packagesSourceDir; in the packaged seed it lives under appDir).
      if (entry === "node_modules" || entry === "dist" || entry === "packages") {
        continue;
      }
      await rm(join(target, entry), { recursive: true, force: true });
      await cp(join(appDir, entry), join(target, entry), {
        recursive: true,
        filter: copyExclude,
      });
    }
  }

  // Vendor the workspace packages (as source — the app imports @bb/* via the
  // `source` export condition) so the UI source installs and builds standalone.
  async function vendorPackages(): Promise<void> {
    if (!existsSync(packagesDir)) {
      return;
    }
    await rm(join(uiDir, "packages"), { recursive: true, force: true });
    await cp(packagesDir, join(uiDir, "packages"), {
      recursive: true,
      filter: copyExclude,
    });
  }

  async function writeWorkspaceFiles(): Promise<void> {
    await writeFile(
      join(uiDir, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n',
      "utf8",
    );
    const repoNpmrc = resolve(appDir, "..", "..", ".npmrc");
    let npmrc = existsSync(repoNpmrc)
      ? `${readFileSync(repoNpmrc, "utf8")}\n`
      : "";
    // The UI source's package.json IS the workspace root; allow plain
    // `pnpm add <dep>` there without the -w flag.
    npmrc += "ignore-workspace-root-check=true\n";
    await writeFile(join(uiDir, ".npmrc"), npmrc, "utf8");
  }

  function runProcess(
    command: string,
    args: string[],
    opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
  ): Promise<{ code: number; log: string }> {
    return new Promise((resolvePromise) => {
      const child = spawn(command, args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
      });
      let log = "";
      let settled = false;
      const collect = (c: Buffer): void => {
        log += c.toString();
        if (log.length > 64_000) log = log.slice(-64_000);
      };
      const finish = (code: number): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({ code, log });
      };
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            child.kill("SIGKILL");
            finish(1);
          }, opts.timeoutMs)
        : undefined;
      timer?.unref();
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", (e) => {
        log += String(e);
        finish(1);
      });
      child.on("close", (code) => finish(code ?? 1));
    });
  }

  let pnpmChecked = false;
  async function ensurePnpm(): Promise<boolean> {
    if (pnpmChecked) return true;
    const check = await runProcess("pnpm", ["--version"], {
      timeoutMs: 30_000,
    });
    if (check.code === 0) {
      pnpmChecked = true;
      return true;
    }
    deps.logger.warn({}, "pnpm not found; installing it globally");
    const inst = await runProcess("npm", ["install", "-g", "pnpm"], {
      timeoutMs: INSTALL_TIMEOUT_MS,
    });
    pnpmChecked = inst.code === 0;
    return pnpmChecked;
  }

  async function runInstall(): Promise<{ ok: boolean; log: string }> {
    if (!(await ensurePnpm())) {
      return {
        ok: false,
        log: "pnpm is not available and could not be installed.",
      };
    }
    // --prod=false + non-production NODE_ENV so devDependencies (vite, the
    // plugins, tailwind) install — they are needed to build.
    const r = await runProcess("pnpm", ["install", "--prod=false"], {
      cwd: uiDir,
      timeoutMs: INSTALL_TIMEOUT_MS,
      env: { ...process.env, NODE_ENV: "development" },
    });
    return { ok: r.code === 0, log: r.log };
  }

  async function defaultPrepareWorkspace(): Promise<{
    ok: boolean;
    log: string;
  }> {
    await vendorPackages();
    await writeWorkspaceFiles();
    return runInstall();
  }
  const prepareWorkspace = deps.prepareWorkspace ?? defaultPrepareWorkspace;

  function packageJsonHash(): string {
    const pkg = join(uiDir, "package.json");
    if (!existsSync(pkg)) return "none";
    return createHash("sha256").update(readFileSync(pkg)).digest("hex");
  }

  // Prepare node_modules for a build: reinstall when package.json changed (a new
  // dependency was added) or node_modules is missing; otherwise skip.
  async function ensureInstalled(
    force: boolean,
  ): Promise<{ ok: boolean; log: string }> {
    const hash = packageJsonHash();
    const viteReady = existsSync(join(uiDir, "node_modules", ".bin", "vite"));
    let marker = "";
    try {
      marker = readFileSync(installMarkerPath, "utf8");
    } catch {
      // No marker yet — treat as needing install.
    }
    if (!force && viteReady && marker === hash) {
      return { ok: true, log: "" };
    }
    const prepared = await prepareWorkspace();
    if (prepared.ok) {
      await writeFile(installMarkerPath, hash, "utf8");
    }
    return prepared;
  }

  async function seed(): Promise<void> {
    await mkdir(uiDir, { recursive: true });
    // Fetch the shipped source if it isn't already on disk (packaged install
    // with no repo clones the matching release tag).
    if (deps.ensureSource) {
      const fetched = await deps.ensureSource();
      if (!fetched.ok) {
        throw new Error(
          `Could not fetch the UI source to edit: ${fetched.log.slice(-400)}`,
        );
      }
    }
    await copyAppSource(uiDir);
    await writeFile(
      join(uiDir, ".gitignore"),
      // Track the app source + package.json + lockfile; ignore vendored deps,
      // installed node_modules, and build output.
      "node_modules\ndist\n.dist-stage\ndist.prev-*\npackages/\n.bb-installed\n",
      "utf8",
    );
    // Build a self-contained workspace (vendor packages + install) so editing
    // package.json to add a dependency actually installs it.
    const prepared = await ensureInstalled(true);
    if (!prepared.ok) {
      deps.logger.warn(
        { log: prepared.log.slice(-2_000) },
        "UI source dependency install failed during seed",
      );
    }
    // Git-track the source so updates can rebase user edits onto a new shipped
    // baseline. Best-effort: a missing git just disables `bb ui update`.
    if (!existsSync(join(uiDir, ".git"))) {
      const init = await runGit(["init", "-b", "ui"]);
      if (init.code === 0) {
        await runGit([...GIT_IDENTITY, "add", "-A"]);
        await runGit([
          ...GIT_IDENTITY,
          "commit",
          "-m",
          `shipped baseline ${deps.version ?? "unknown"}`,
        ]);
        await runGit(["branch", "shipped"]);
      } else {
        deps.logger.warn(
          { stderr: init.stderr },
          "git unavailable; UI-source updates disabled",
        );
      }
    }
    await writeState({ version: deps.version ?? null });
    deps.logger.info({ uiDir }, "Seeded UI source from shipped app");
  }

  async function defaultRunBuild(): Promise<{ ok: boolean; log: string }> {
    const viteBin = join(uiDir, "node_modules", ".bin", "vite");
    const args = [
      "build",
      "--config",
      join(uiDir, "vite.ui.config.ts"),
      "--logLevel",
      "warn",
    ];
    return await new Promise((resolvePromise) => {
      const child = spawn(viteBin, args, {
        cwd: uiDir,
        env: {
          ...process.env,
          NODE_ENV: "production",
          BB_UI_DIR: uiDir,
          BB_UI_OUT: stageDir,
        },
      });
      let log = "";
      let settled = false;
      const collect = (chunk: Buffer): void => {
        log += chunk.toString();
        if (log.length > 64_000) {
          log = log.slice(-64_000);
        }
      };
      const finish = (result: { ok: boolean; log: string }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise(result);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({
          ok: false,
          log: `${log}\nBuild timed out after ${BUILD_TIMEOUT_MS}ms`,
        });
      }, BUILD_TIMEOUT_MS);
      timer.unref();
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("error", (error) => {
        finish({ ok: false, log: `${log}\n${String(error)}` });
      });
      child.on("close", (code) => {
        finish({ ok: code === 0, log });
      });
    });
  }

  // Tests inject deps.buildRunner to avoid a real Vite build; production uses
  // the default. The runner is responsible for writing the staged dist.
  const runBuild = deps.buildRunner
    ? () => deps.buildRunner!({ uiDir, stageDir, appDir })
    : defaultRunBuild;

  async function promoteStageToDist(): Promise<void> {
    const previous = `${distDir}.prev-${Date.now()}`;
    if (existsSync(distDir)) {
      await rename(distDir, previous);
    }
    await rename(stageDir, distDir);
    await rm(previous, { recursive: true, force: true });
  }

  // Remove orphaned dist.prev-* dirs left by a crash between promote renames.
  function sweepStalePromotions(): void {
    try {
      for (const entry of readdirSync(uiDir)) {
        if (entry.startsWith("dist.prev-")) {
          rmSync(join(uiDir, entry), { recursive: true, force: true });
        }
      }
    } catch {
      // uiDir may not exist yet, or a sibling sweep already removed it.
    }
  }

  // Serialize file-mutating operations so two concurrent CLI calls cannot race
  // on the shared stage dir or clobber state. Each op runs after the previous
  // settles (success or failure).
  let mutationChain: Promise<unknown> = Promise.resolve();
  function mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = mutationChain.then(fn, fn);
    mutationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function isSeeded(): boolean {
    return existsSync(join(uiDir, "index.html"));
  }

  // Scoped `tsc --noEmit` over the UI source (tests excluded via
  // tsconfig.ui-check.json). Returns the error output, or null when clean /
  // unavailable. Advisory: the Vite build strips types, so this is the only
  // type feedback an agent gets.
  async function runTypecheck(): Promise<string | null> {
    if (deps.buildRunner) {
      return null; // unit tests fake the build — no real toolchain/source.
    }
    const tscBin = join(uiDir, "node_modules", ".bin", "tsc");
    const config = join(uiDir, "tsconfig.ui-check.json");
    if (!existsSync(tscBin) || !existsSync(config)) {
      return null;
    }
    const result = await runProcess(tscBin, ["-p", config, "--noEmit"], {
      cwd: uiDir,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    return result.code === 0 ? null : result.log.slice(-8_000);
  }

  // Install (if package.json changed) + build to staging + promote. Shared by
  // fork and apply; the caller writes state / activates the fork on success.
  async function buildAndPromote(): Promise<{
    ok: boolean;
    error?: string;
    log?: string;
    typeErrors?: string;
  }> {
    sweepStalePromotions();
    const installed = await ensureInstalled(false);
    if (!installed.ok) {
      return {
        ok: false,
        error: "Dependency install failed",
        log: installed.log.slice(-8_000),
      };
    }
    // Build and typecheck concurrently: the build gates serving (Vite has no
    // type info), the typecheck is advisory feedback for the agent.
    const [build, typeErrors] = await Promise.all([runBuild(), runTypecheck()]);
    if (!build.ok || !existsSync(join(stageDir, "index.html"))) {
      await rm(stageDir, { recursive: true, force: true });
      return {
        ok: false,
        error: "UI source build failed",
        log: build.log.slice(-8_000),
      };
    }
    await promoteStageToDist();
    return { ok: true, typeErrors: typeErrors ?? undefined };
  }

  async function activateFork(): Promise<void> {
    await writeState({
      active: "fork",
      status: "ready",
      seeded: true,
      lastBuiltAt: now(),
      error: null,
    });
    deps.hub.notifySystem(["ui-reloaded", "ui-status-changed"]);
  }

  async function failBuild(error: string | undefined): Promise<void> {
    await writeState({ status: "error", error: error ?? null });
    deps.hub.notifySystem(["ui-status-changed"]);
  }

  // Create the editable fork (seed on first run / --reset) and switch to it.
  async function doFork(reset: boolean): Promise<UiSourceApplyResult> {
    await writeState({ status: "building", error: null });
    try {
      if (reset) {
        await rm(uiDir, { recursive: true, force: true });
      }
      if (!isSeeded()) {
        await seed();
      } else if (existsSync(join(distDir, "index.html"))) {
        // Already forked + built — just switch back to the fork, no rebuild.
        await writeState({ active: "fork", status: "ready", seeded: true });
        deps.hub.notifySystem(["ui-reloaded", "ui-status-changed"]);
        return { ok: true, state };
      }
      const built = await buildAndPromote();
      if (!built.ok) {
        await failBuild(built.error);
        return { ok: false, state, error: built.error, log: built.log };
      }
      await activateFork();
      deps.logger.info({ uiDir }, "Forked UI source and switched to it");
      return { ok: true, state, typeErrors: built.typeErrors };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await rm(stageDir, { recursive: true, force: true }).catch(() => {});
      await failBuild(message);
      deps.logger.error({ err: error }, "UI source fork failed");
      return { ok: false, state, error: message };
    }
  }

  // Rebuild the fork after edits. Requires a fork to exist.
  async function doApply(): Promise<UiSourceApplyResult> {
    if (!isSeeded()) {
      return {
        ok: false,
        state,
        error: "No UI fork yet — run `bb ui fork` first.",
      };
    }
    await writeState({ status: "building", error: null });
    try {
      const built = await buildAndPromote();
      if (!built.ok) {
        await failBuild(built.error);
        return { ok: false, state, error: built.error, log: built.log };
      }
      await activateFork();
      deps.logger.info({ uiDir }, "Applied UI source build and broadcast reload");
      return { ok: true, state, typeErrors: built.typeErrors };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await rm(stageDir, { recursive: true, force: true }).catch(() => {});
      await failBuild(message);
      deps.logger.error({ err: error }, "UI source apply failed");
      return { ok: false, state, error: message };
    }
  }

  // Switch back to the shipped (production) UI. The fork stays on disk.
  async function doProd(): Promise<UiSourceState> {
    await writeState({ active: "prod" });
    deps.hub.notifySystem(["ui-reloaded", "ui-status-changed"]);
    deps.logger.info({}, "Switched to the shipped UI and broadcast reload");
    return state;
  }

  async function listConflicts(): Promise<string[]> {
    const r = await runGit(["diff", "--name-only", "--diff-filter=U"]);
    return r.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // After a successful rebase, rebuild the rebased working tree and serve it.
  async function finishUpdateAfterRebase(): Promise<UiUpdateResult> {
    await writeState({ conflictFiles: [] });
    // The new shipped baseline may carry new @bb/* source or new deps — force a
    // re-vendor + reinstall before rebuilding.
    const prepared = await ensureInstalled(true);
    if (!prepared.ok) {
      await writeState({
        status: "error",
        error: "Dependency install failed after update",
      });
      deps.hub.notifySystem(["ui-status-changed"]);
      return { ok: false, state, error: "Dependency install failed after update" };
    }
    const result = await doApply();
    if (!result.ok) {
      return { ok: false, state, error: result.error };
    }
    // Advance the recorded version only after the updated UI actually builds.
    await writeState({ version: deps.version ?? state.version });
    return { ok: true, state };
  }

  async function doUpdate(mode: UiUpdateMode): Promise<UiUpdateResult> {
    if (!existsSync(join(uiDir, ".git"))) {
      return {
        ok: false,
        state,
        error:
          "UI source is not git-tracked; run `bb ui reset` to re-seed with tracking.",
      };
    }

    if (mode === "abort" || mode === "continue") {
      const inProgress =
        existsSync(join(uiDir, ".git", "rebase-merge")) ||
        existsSync(join(uiDir, ".git", "rebase-apply"));
      if (!inProgress) {
        return { ok: false, state, error: "No UI update is in progress." };
      }
    }

    if (mode === "abort") {
      await runGit([...GIT_IDENTITY, "rebase", "--abort"]);
      // Restore the user to where they were before `update`: the conflict path
      // never rebuilt, so their last-good UI build is still on disk — serve it.
      await writeState({ active: "fork", status: "ready", conflictFiles: [] });
      deps.hub.notifySystem(["ui-reloaded", "ui-status-changed"]);
      return { ok: true, state };
    }

    if (mode === "continue") {
      await runGit([...GIT_IDENTITY, "add", "-A"]);
      const cont = await runGit([...GIT_IDENTITY, "rebase", "--continue"]);
      if (cont.code !== 0) {
        const conflicts = await listConflicts();
        await writeState({ status: "needs-rebase", conflictFiles: conflicts });
        deps.hub.notifySystem(["ui-status-changed"]);
        return {
          ok: false,
          state,
          conflictFiles: conflicts,
          error: "Rebase still has conflicts",
        };
      }
      return await finishUpdateAfterRebase();
    }

    // mode === "start"
    // Packaged installs seed from a cloned release source. Refresh that clone
    // before comparing the shipped baseline, or an app upgrade can look
    // falsely up to date against the prior cached ref.
    if (deps.ensureSource) {
      const fetched = await deps.ensureSource();
      if (!fetched.ok) {
        const error = `Could not fetch the UI source to update: ${fetched.log.slice(
          -400,
        )}`;
        await writeState({ status: "error", error });
        deps.hub.notifySystem(["ui-status-changed"]);
        return { ok: false, state, error };
      }
    }
    // 1. Commit any working edits so the checkout below is clean (a no-op
    //    commit just fails harmlessly when there is nothing to commit).
    await runGit([...GIT_IDENTITY, "add", "-A"]);
    await runGit([...GIT_IDENTITY, "commit", "-m", `ui edits ${now()}`]);
    // 2. Refresh the shipped baseline branch with the current shipped source.
    await runGit(["checkout", "shipped"]);
    await copyAppSource(uiDir);
    await runGit([...GIT_IDENTITY, "add", "-A"]);
    const diff = await runGit(["diff", "--cached", "--quiet"]);
    if (diff.code === 0) {
      await runGit(["checkout", "ui"]);
      return { ok: true, state, upToDate: true };
    }
    await runGit([
      ...GIT_IDENTITY,
      "commit",
      "-m",
      `shipped baseline ${deps.version ?? "updated"}`,
    ]);
    // 3. Rebase the user's edits onto the new shipped baseline.
    await runGit(["checkout", "ui"]);
    const rebase = await runGit([...GIT_IDENTITY, "rebase", "shipped"]);
    if (rebase.code !== 0) {
      const conflicts = await listConflicts();
      // Fall back to the shipped UI so the app keeps working; leave the rebase
      // in progress for an agent to resolve and `bb ui update --continue`.
      // Keep the recorded version unchanged: the update is not done until the
      // rebase resolves and rebuilds, so callers must not see it as up to date.
      await writeState({
        active: "prod",
        status: "needs-rebase",
        conflictFiles: conflicts,
      });
      deps.hub.notifySystem(["ui-reloaded", "ui-status-changed"]);
      return {
        ok: false,
        state,
        conflictFiles: conflicts,
        error: "Update conflicts with your UI edits",
      };
    }
    return await finishUpdateAfterRebase();
  }

  return {
    getState: () => state,
    getSourceDir: () => uiDir,
    isEnabled,
    resolveActiveRoot: (shippedDir) => {
      // Experiment off: always serve the shipped UI, even if a fork was built.
      if (!isEnabled()) {
        return shippedDir;
      }
      if (state.active === "fork" && existsSync(join(distDir, "index.html"))) {
        return distDir;
      }
      return shippedDir;
    },
    fork: (opts) => mutate(() => doFork(opts?.reset ?? false)),
    apply: () => mutate(doApply),
    prod: () => mutate(doProd),
    update: (mode) => mutate(() => doUpdate(mode)),
  };
}
