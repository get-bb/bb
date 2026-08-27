import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  BB_CLI_MARKER_TEXT,
  createAppImageBootstrapScript,
  createHomeCliWrapperScript,
  type BbCliWrapperTarget,
} from "./cli-wrapper-script.js";
import type { DesktopReleaseInfo } from "./desktop-update-provider.js";

/**
 * The ~/.bb/bin refresh.
 *
 * This is the only path a user ever puts on PATH, so it must stay valid across
 * install location, channel, and app moves. It is rewritten on every launch,
 * which is what makes moving, renaming, or auto-updating the app self-healing.
 */

const APPIMAGE_BOOTSTRAP_FILE_NAME = "bb-bootstrap.mjs";
const WRAPPER_MODE = 0o755;

export type BbCliLinkStatus =
  | { kind: "written"; path: string }
  | { kind: "unchanged"; path: string }
  | { kind: "foreign-file"; path: string }
  | { kind: "failed"; message: string };

export interface RefreshHomeCliWrapperArgs {
  commandName: string;
  homeDir: string;
  logger: { warn(message: string): void };
  target: BbCliWrapperTarget;
}

interface ResolveCliCommandNameArgs {
  /**
   * electron-builder's productName. Typed as the exhaustive channel union
   * (matching `DesktopReleaseInfo["applicationName"]`) rather than a plain
   * string with a `?? "bb"` fallback: a fallback here would let a drifted or
   * new product name silently write `~/.bb/bin/bb` and shadow stable, which is
   * exactly the failure this feature exists to prevent. Adding a channel is a
   * compile error until this switch is updated.
   */
  productName: DesktopReleaseInfo["applicationName"];
}

interface ResolveHomeCliBinDirArgs {
  homeDir: string;
}

interface ResolveCliWrapperTargetArgs {
  /** From resolveCliCommandName; the wrapper is named for the channel. */
  commandName: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: NodeJS.Platform;
  resourcesPath: string;
}

/**
 * Channel command names. Stable is `bb`, nightly is `bb-nightly`, matching the
 * Linux executable policy in desktop-release-channel.mjs: a shared name would
 * let one channel shadow the other on PATH, and the two are meant to be
 * installed side by side.
 */
export function resolveCliCommandName(
  args: ResolveCliCommandNameArgs,
): string {
  switch (args.productName) {
    case "bb":
      return "bb";
    case "bb Nightly":
      return "bb-nightly";
  }
}

/**
 * Anchored to $HOME, never to the configured data directory. The PATH line a
 * user adds by hand has to be a fixed, predictable string that survives a
 * data-directory change.
 */
export function resolveHomeCliBinDir(args: ResolveHomeCliBinDirArgs): string {
  return join(args.homeDir, ".bb", "bin");
}

/**
 * What ~/.bb/bin should point at for the app currently running.
 *
 * Returns null when there is nothing stable to record: a Linux build outside an
 * AppImage has no $APPIMAGE, and an unsupported platform has no design.
 */
export function resolveCliWrapperTarget(
  args: ResolveCliWrapperTargetArgs,
): BbCliWrapperTarget | null {
  if (args.platform === "darwin") {
    // <bundle>/Contents/Resources -> <bundle>
    const appBundlePath = dirname(dirname(args.resourcesPath));
    return {
      kind: "macos-bundle",
      appBundlePath,
      wrapperPath: join(args.resourcesPath, "bin", args.commandName),
    };
  }

  if (args.platform !== "linux") {
    return null;
  }

  const appImagePath = args.env.APPIMAGE?.trim() ?? "";
  if (appImagePath.length === 0) {
    return null;
  }

  return {
    kind: "linux-appimage",
    appImagePath,
    bootstrapPath: join(
      resolveHomeCliBinDir({ homeDir: args.homeDir }),
      APPIMAGE_BOOTSTRAP_FILE_NAME,
    ),
  };
}

/**
 * True when the file at `path` is one of ours, or absent.
 *
 * Anything else belongs to Homebrew, npm, or the user, and is never
 * overwritten. Matches on the prefix-free marker text so it recognizes either
 * comment style this feature writes: the shell `#` form in the wrapper and the
 * JS `//` form in the AppImage bootstrap. A read failure counts as foreign:
 * refusing to write is the safe direction.
 */
async function isOursOrAbsent(path: string): Promise<boolean> {
  try {
    return (await readFile(path, "utf8")).includes(BB_CLI_MARKER_TEXT);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, WRAPPER_MODE);
}

/**
 * Rewrite ~/.bb/bin/<name> for the running app. Called on every launch: the
 * cost is one read plus an occasional rewrite, and every-launch is what makes
 * a moved or updated app self-heal without the user doing anything.
 *
 * On Linux, the AppImage bootstrap at `target.bootstrapPath` is a second file
 * this feature owns and is guarded the same way as the wrapper: a foreign file
 * there is left alone and reported instead of being clobbered.
 */
export async function refreshHomeCliWrapper(
  args: RefreshHomeCliWrapperArgs,
): Promise<BbCliLinkStatus> {
  const binDir = resolveHomeCliBinDir({ homeDir: args.homeDir });
  const wrapperPath = join(binDir, args.commandName);

  try {
    if (!(await isOursOrAbsent(wrapperPath))) {
      args.logger.warn(
        `Left ${wrapperPath} alone: it was not written by bb. Remove it to let bb manage this command.`,
      );
      return { kind: "foreign-file", path: wrapperPath };
    }

    if (
      args.target.kind === "linux-appimage" &&
      !(await isOursOrAbsent(args.target.bootstrapPath))
    ) {
      args.logger.warn(
        `Left ${args.target.bootstrapPath} alone: it was not written by bb. Remove it to let bb manage this command.`,
      );
      return { kind: "foreign-file", path: args.target.bootstrapPath };
    }

    const desired = createHomeCliWrapperScript({
      commandName: args.commandName,
      target: args.target,
    });
    await mkdir(binDir, { recursive: true });

    if (args.target.kind === "linux-appimage") {
      await writeFile(
        args.target.bootstrapPath,
        createAppImageBootstrapScript(),
      );
    }

    // Read content and mode together: if either lookup fails (including the
    // file not existing), treat the wrapper as needing a rewrite. That is the
    // safe direction, and it means a mode-only drift (a stray chmod, a
    // cloud-sync restore, an archive/quarantine extraction) still gets healed
    // on the next launch even though the content never changed.
    let current: string | null = null;
    let currentMode: number | null = null;
    try {
      current = await readFile(wrapperPath, "utf8");
      currentMode = (await stat(wrapperPath)).mode & 0o777;
    } catch {
      current = null;
      currentMode = null;
    }

    if (current === desired && currentMode === WRAPPER_MODE) {
      return { kind: "unchanged", path: wrapperPath };
    }

    await writeExecutable(wrapperPath, desired);
    return { kind: "written", path: wrapperPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    args.logger.warn(`Could not refresh ${wrapperPath}: ${message}`);
    return { kind: "failed", message };
  }
}
