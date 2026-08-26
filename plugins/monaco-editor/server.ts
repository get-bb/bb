// bb-plugin-monaco-editor — backend entry.
//
// Three jobs, all in service of the `fileOpener` slot in app.tsx:
//   1. `assets`  — hand the frontend a URL it can load Monaco's AMD build from.
//   2. `read`    — read the opened file off whichever host owns it.
//   3. `write`   — save it back, guarded by a content hash.
//
// Everything file-shaped goes through `bb.sdk.files`, never `node:fs`: the
// file being edited may live on an enrolled remote machine, and `rootPath`
// confinement plus the compare-and-swap guard are the reason to use it even
// when it does not.
import path from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** Files above this are refused: Monaco bogs down and the tab is unusable. */
const MAX_EDITABLE_BYTES = 8 * 1024 * 1024;

/**
 * Ceiling on the file-tree listing — also the daemon's own maximum, which
 * rejects anything larger with "Too big: expected number to be <=10000".
 * A repository bigger than this lists partially and says so.
 */
const MAX_TREE_ENTRIES = 10_000;

/**
 * Preview lease lifetime. One hour is the server's maximum — it rejects
 * anything larger with "Too big: expected number to be <=3600000" — so the
 * lease is re-issued rather than held.
 */
const ASSET_LEASE_TTL_MS = 60 * 60 * 1000;

/**
 * Re-issue the lease when it has less than this left. Comfortably longer than
 * a page load, so a tab opening near expiry never races it.
 */
const ASSET_LEASE_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * `PluginFileOpenerSource` as it arrives over the wire. BB owns this shape;
 * we re-validate it because RPC input is a boundary like any other.
 */
const sourceSchema = z
  .object({
    kind: z.enum(["workspace", "host", "thread-storage"]),
    threadId: z.string().nullable(),
    environmentId: z.string().nullable(),
    projectId: z.string().nullable(),
    /** Set for a project-backed workspace file opened on a non-primary host. */
    experimental_hostId: z.string().optional(),
  })
  .strict();

const fileSchema = z
  .object({ path: z.string().min(1), source: sourceSchema })
  .strict();

export const rpcContract = defineRpcContract({
  assets: {
    input: z.null(),
    output: z.object({ baseUrl: z.string(), expiresAtMs: z.number() }),
  },
  read: {
    input: fileSchema,
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("text"),
        content: z.string(),
        sha256: z.string(),
        /**
         * Where the file actually lives, and its path within the root
         * `read`/`write` confine to. The frontend has neither: BB hands the
         * opener a path relative to the workspace (or an absolute one, for a
         * host file), and resolving it needs the environment lookup that only
         * happens here. Returned with the content so the "copy path" palette
         * commands need no second round trip.
         */
        absolutePath: z.string(),
        relativePath: z.string(),
      }),
      // Not an error: binary and oversized files are ordinary things to click
      // on. The frontend renders BB's own preview for these instead.
      z.object({ kind: z.literal("unsupported"), reason: z.string() }),
    ]),
  },
  tree: {
    input: z.object({ source: sourceSchema }).strict(),
    output: z.object({
      /** Absolute root the entries are relative to, for "copy absolute path". */
      root: z.string(),
      entries: z.array(
        z.object({
          path: z.string(),
          kind: z.enum(["file", "directory"]),
        }),
      ),
      // The daemon caps its own listing; surfacing the flag lets the UI say
      // "showing the first N" instead of quietly presenting a partial tree
      // as if it were the whole project.
      truncated: z.boolean(),
    }),
  },
  write: {
    input: fileSchema.extend({
      content: z.string(),
      // The hash `read` returned. Null means "create only" — we never send it
      // today, but the SDK distinguishes it from an absent guard, so the
      // contract keeps the distinction rather than collapsing it.
      expectedSha256: z.string().nullable(),
    }),
    output: z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("written"), sha256: z.string() }),
      z.object({
        outcome: z.literal("conflict"),
        currentSha256: z.string().nullable(),
      }),
    ]),
  },
});

/**
 * Whether a built bundle predates what it was built from.
 *
 * The dev loop rebuilds `dist/app.js` and reloads `server.ts` on save, but
 * knows nothing about this bundle, so without this an edit to
 * `monaco-bundle/` or a bumped `monaco-editor` would leave a stale bundle in
 * place and the change would silently not appear.
 *
 * Only meaningful in a source checkout. A packaged plugin has no
 * `monaco-bundle/` beside it — nothing to be newer than the artifact — so
 * this returns false there without stat-ing anything that matters.
 */
function isBundleStale(moduleDir: string, bundleDir: string): boolean {
  const builtAtMs = statSync(path.join(bundleDir, "editor.js")).mtimeMs;
  const entryDir = path.join(moduleDir, "monaco-bundle");
  if (!existsSync(entryDir)) return false;

  const inputs = [
    path.join(moduleDir, "scripts", "stage-assets.mjs"),
    ...readdirSync(entryDir).map((name) => path.join(entryDir, name)),
    // A `monaco-editor` bump changes nothing this plugin owns, so compare
    // against the installed package itself.
    path.join(moduleDir, "package.json"),
  ];
  return inputs.some(
    (input) => existsSync(input) && statSync(input).mtimeMs > builtAtMs,
  );
}

/**
 * The directory holding the Monaco bundle this plugin serves, building it
 * first if it is not there.
 *
 * `scripts/stage-assets.mjs` builds it into `dist/monaco`. Packaging runs
 * that script (`apps/server/scripts/copy-builtin-plugins.ts`), so a released
 * BB always finds it already built — but a source checkout never runs it: the
 * dev server loads builtins straight from `plugins/<name>` and rebuilds only
 * `dist/app.js` on demand. Without the fallback below, `pnpm dev` on a fresh
 * clone would load this plugin into an error state.
 *
 * The two candidates are the two layouts this file runs under. Packaged, the
 * server bundle sits at `dist/server.js` with `dist/monaco` beside it; from
 * source, `server.ts` sits at the plugin root with `dist/monaco` below it.
 */
async function ensureMonacoBundleDir(
  log: (message: string) => void,
): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "monaco"),
    path.join(moduleDir, "dist", "monaco"),
  ];
  const built = candidates.find((candidate) =>
    existsSync(path.join(candidate, "editor.js")),
  );
  if (built !== undefined && !isBundleStale(moduleDir, built)) return built;

  // Building takes a few seconds, so say why this file open is slow.
  log(
    built === undefined
      ? "Monaco bundle missing; building it (first run in a source checkout)"
      : "Monaco bundle is older than its sources; rebuilding it",
  );
  // A computed specifier, so the plugin's own bundler leaves it alone rather
  // than trying to inline a build script into the server bundle. Importing it
  // runs it — the same contract packaging relies on.
  const script = new URL("./scripts/stage-assets.mjs", import.meta.url).href;
  await import(script);

  const staged = candidates.find((candidate) =>
    existsSync(path.join(candidate, "editor.js")),
  );
  if (staged === undefined) {
    throw new Error(
      "could not build the Monaco bundle; run `pnpm --filter bb-plugin-monaco-editor build:monaco`",
    );
  }
  return staged;
}

export default async function plugin(bb: BbPluginApi) {

  let assetLease: { baseUrl: string; expiresAtMs: number } | null = null;

  /**
   * A preview URL over Monaco's asset directory, refreshed before it lapses.
   * `createPreview` serves any file beneath the root from BB's own origin,
   * which is what lets the AMD loader pull `editor.main.js`, the stylesheet,
   * and each language definition on demand.
   */
  async function assets() {
    const now = Date.now();
    if (
      assetLease === null ||
      assetLease.expiresAtMs - now < ASSET_LEASE_REFRESH_MARGIN_MS
    ) {
      const bundleDir = await ensureMonacoBundleDir((message) =>
        bb.log.info(message),
      );
      // No hostId: the bundle is part of the plugin, on the server.
      assetLease = await bb.sdk.files.createPreview({
        rootPath: bundleDir,
        ttlMs: ASSET_LEASE_TTL_MS,
      });
    }
    return assetLease;
  }

  /**
   * The thread-storage root, mirroring the server's own resolution: the
   * `BB_THREAD_STORAGE` override if set, else `<dataDir>/thread-storage`.
   * Reading `process.env` is legitimate here — plugins run in-process inside
   * the server, so this is the same environment the server resolved from.
   */
  async function threadStorageRoot(): Promise<string> {
    const override = process.env.BB_THREAD_STORAGE;
    if (override && override.trim().length > 0) return path.resolve(override);
    const { dataDir } = await bb.sdk.system.config();
    return path.join(dataDir, "thread-storage");
  }

  /**
   * Where a file the user clicked actually lives. `workspace` paths are
   * worktree-relative and need the environment to become absolute; `host`
   * paths are already absolute; thread-storage paths are relative to the
   * thread's own storage directory. All three are confined to a root, so a
   * traversal in the path cannot escape the worktree, the file's directory,
   * or the thread's storage.
   *
   * BB's public API is read-only over thread storage, so we resolve it to a
   * plain filesystem path instead and get editing for free. Known limitation:
   * `dataDir` is the *server's*, so a thread whose environment lives on an
   * enrolled remote machine resolves to a path that does not exist there and
   * fails to open rather than silently touching the wrong host's disk.
   */
  async function resolveTarget(
    source: z.infer<typeof sourceSchema>,
    filePath: string,
  ): Promise<{ path: string; rootPath: string; hostId?: string }> {
    if (source.kind === "thread-storage") {
      if (source.threadId === null) {
        throw new Error("This thread-storage file has no thread");
      }
      const rootPath = path.join(await threadStorageRoot(), source.threadId);
      return { path: path.join(rootPath, filePath), rootPath };
    }
    // A workspace file opened from a project surface has no environment: it
    // lives directly in one of the project's source checkouts. `hostId` is
    // explicit there, because a project's sources can span hosts.
    if (source.environmentId === null && source.kind === "workspace") {
      if (source.projectId === null) {
        throw new Error("This file has no environment or project");
      }
      const project = await bb.sdk.projects.get({
        projectId: source.projectId,
      });
      const sources = project.sources;
      const checkout =
        source.experimental_hostId === undefined
          ? (sources.find((entry) => entry.isDefault) ?? sources[0])
          : sources.find(
              (entry) => entry.hostId === source.experimental_hostId,
            );
      if (checkout === undefined) {
        throw new Error("This project has no matching source checkout");
      }
      return {
        path: path.join(checkout.path, filePath),
        rootPath: checkout.path,
        hostId: checkout.hostId,
      };
    }
    if (source.environmentId === null) {
      throw new Error("This file has no environment to resolve it against");
    }
    const environment = await bb.sdk.environments.get({
      environmentId: source.environmentId,
    });

    if (source.kind === "host") {
      // Absolute already; confine to its own directory so the path cannot
      // walk somewhere else on the host.
      const api = path.win32.isAbsolute(filePath) ? path.win32 : path.posix;
      return {
        path: filePath,
        rootPath: api.dirname(filePath),
        ...(environment.hostId ? { hostId: environment.hostId } : {}),
      };
    }

    if (!environment.path) {
      throw new Error("This environment has no workspace path");
    }
    return {
      path: path.join(environment.path, filePath),
      rootPath: environment.path,
      ...(environment.hostId ? { hostId: environment.hostId } : {}),
    };
  }

  /**
   * `root`-relative form of `target`. The daemon may hand back a Windows
   * root, so pick the path flavour from the root rather than the host we
   * happen to be running on.
   */
  function relativeTo(root: string, target: string): string {
    const api = path.win32.isAbsolute(root) ? path.win32 : path.posix;
    return api.relative(root, target) || api.basename(target);
  }

  bb.rpc.register(rpcContract, {
    assets: () => assets(),

    async read({ path: filePath, source }) {
      const target = await resolveTarget(source, filePath);
      const file = await bb.sdk.files.read(target);

      // The daemon returns base64 when the bytes are not valid UTF-8. Handing
      // that to Monaco would render mojibake and, worse, saving it would
      // corrupt the file.
      if (file.contentEncoding !== "utf8") {
        return { kind: "unsupported" as const, reason: "This file is not text" };
      }
      if (file.sizeBytes > MAX_EDITABLE_BYTES) {
        return {
          kind: "unsupported" as const,
          reason: `This file is too large to edit (${Math.round(file.sizeBytes / 1024 / 1024)} MB)`,
        };
      }
      return {
        kind: "text" as const,
        content: file.content,
        sha256: file.sha256,
        absolutePath: target.path,
        // Same rooting as `tree`, so the two agree on what "relative" means:
        // the worktree for a workspace file, the thread's storage directory,
        // and — for a bare host path — the file's own directory, which leaves
        // just the filename.
        relativePath: relativeTo(target.rootPath, target.path),
      };
    },

    /**
     * The file tree the "Show in files" panel renders, as a flat list of
     * root-relative paths; the frontend nests them.
     *
     * Rooted at the same place `read`/`write` confine to — the worktree for a
     * workspace file, the thread's storage directory, the file's own
     * directory for a bare host path (there is no project to speak of there).
     */
    async tree({ source }) {
      const target = await resolveTarget(source, ".");
      const result = await bb.sdk.files.listPaths({
        path: target.rootPath,
        includeFiles: true,
        includeDirectories: true,
        limit: MAX_TREE_ENTRIES,
        ...(target.hostId !== undefined ? { hostId: target.hostId } : {}),
      });
      return {
        root: target.rootPath,
        entries: result.paths.map((entry) => ({
          path: entry.path,
          kind: entry.kind,
        })),
        truncated: result.truncated,
      };
    },

    async write({ path: filePath, source, content, expectedSha256 }) {
      const target = await resolveTarget(source, filePath);
      const result = await bb.sdk.files.write({
        ...target,
        content,
        contentEncoding: "utf8",
        expectedSha256,
      });
      return result.outcome === "written"
        ? { outcome: "written" as const, sha256: result.sha256 }
        : { outcome: "conflict" as const, currentSha256: result.currentSha256 };
    },
  });

}
