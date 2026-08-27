import { execSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveBundleFromCliPath,
  runInstallCli,
  WRAPPER_MARKER,
} from "../commands/install-cli.js";

const BUNDLE_CLI_SUFFIX = join(
  "Contents",
  "Resources",
  "app.asar.unpacked",
  "node_modules",
  "bb-app",
  "host-daemon",
  "dist",
  "bb",
);

async function writeBundleBinEntries(
  appBundlePath: string,
  names: string[],
): Promise<void> {
  const binDir = join(appBundlePath, "Contents", "Resources", "bin");
  await mkdir(binDir, { recursive: true });
  for (const name of names) {
    await writeFile(join(binDir, name), "#!/bin/sh\n");
  }
}

function cliPathFor(appBundlePath: string): string {
  return `${appBundlePath}${sep}${BUNDLE_CLI_SUFFIX}`;
}

describe("resolveBundleFromCliPath", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "bb-cli-install-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("walks up from the bundled CLI to the app bundle and reads the command name from Resources/bin", async () => {
    const appBundlePath = join(tempRoot, "bb.app");
    await writeBundleBinEntries(appBundlePath, ["bb"]);

    await expect(
      resolveBundleFromCliPath({
        cliPath: cliPathFor(appBundlePath),
        platform: "darwin",
      }),
    ).resolves.toEqual({
      appBundlePath,
      commandName: "bb",
      wrapperPath: join(appBundlePath, "Contents", "Resources", "bin", "bb"),
    });
  });

  it("derives the command name from ground truth, not from the bundle's directory name", async () => {
    // A renamed "bb Nightly.app" (or any other directory name) must still
    // resolve to whatever command name the build actually shipped in
    // Contents/Resources/bin -- guessing from the bundle name would let a
    // renamed nightly bundle silently shadow a stable install at ~/.bb/bin/bb.
    const appBundlePath = join(tempRoot, "Totally Renamed.app");
    await writeBundleBinEntries(appBundlePath, ["bb-nightly"]);

    await expect(
      resolveBundleFromCliPath({
        cliPath: cliPathFor(appBundlePath),
        platform: "darwin",
      }),
    ).resolves.toMatchObject({ commandName: "bb-nightly" });
  });

  it("returns null when Resources/bin is empty", async () => {
    const appBundlePath = join(tempRoot, "bb.app");
    await writeBundleBinEntries(appBundlePath, []);

    await expect(
      resolveBundleFromCliPath({
        cliPath: cliPathFor(appBundlePath),
        platform: "darwin",
      }),
    ).resolves.toBeNull();
  });

  it("returns null when Resources/bin has more than one entry", async () => {
    // Two entries means there is no single ground truth to trust; guessing
    // which one is the real channel name is exactly the failure mode this
    // command must avoid.
    const appBundlePath = join(tempRoot, "bb.app");
    await writeBundleBinEntries(appBundlePath, ["bb", "bb-nightly"]);

    await expect(
      resolveBundleFromCliPath({
        cliPath: cliPathFor(appBundlePath),
        platform: "darwin",
      }),
    ).resolves.toBeNull();
  });

  it("returns null when Resources/bin is missing", async () => {
    const appBundlePath = join(tempRoot, "bb.app");
    // No Contents/Resources/bin directory created at all.

    await expect(
      resolveBundleFromCliPath({
        cliPath: cliPathFor(appBundlePath),
        platform: "darwin",
      }),
    ).resolves.toBeNull();
  });

  it("returns null for an npm-global install with no app bundle", async () => {
    // `npm i -g bb-app` already puts bb on PATH by another route; there is no
    // bundle to link, so the command must say so rather than write a wrapper
    // pointing at nothing.
    await expect(
      resolveBundleFromCliPath({
        cliPath: "/Users/x/.local/share/mise/installs/node/22/bin/bb",
        platform: "darwin",
      }),
    ).resolves.toBeNull();
  });

  it("returns null on Linux, where there is no in-bundle wrapper", async () => {
    // An AppImage self-mounts at an ephemeral path, so ~/.bb/bin has to be
    // written by the app at launch from $APPIMAGE, not by the CLI.
    await expect(
      resolveBundleFromCliPath({
        cliPath:
          "/tmp/.mount_bbXXXX/resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb",
        platform: "linux",
      }),
    ).resolves.toBeNull();
  });
});

describe("WRAPPER_MARKER", () => {
  it("matches apps/desktop/src/cli-wrapper-script.ts's BB_CLI_WRAPPER_MARKER literal", () => {
    // Both sides carry independent copies of the same literal by design (this
    // CLI ships inside the daemon bundle and cannot import @bb/desktop), so
    // this asserts the value directly rather than importing across packages.
    expect(WRAPPER_MARKER).toBe(
      "# bb-managed: generated by the bb desktop app. Safe to delete.",
    );
  });
});

describe("runInstallCli", () => {
  let tempRoot: string;
  let homeDir: string;
  let appBundlePath: string;
  let cliPath: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "bb-cli-install-run-"));
    homeDir = join(tempRoot, "home");
    await mkdir(homeDir, { recursive: true });
    appBundlePath = join(tempRoot, "bb.app");
    await writeBundleBinEntries(appBundlePath, ["bb"]);
    cliPath = cliPathFor(appBundlePath);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("writes an executable wrapper carrying the marker on a fresh install", async () => {
    const result = await runInstallCli({
      cliPath,
      homeDir,
      platform: "darwin",
    });

    expect(result).toEqual({
      binDir: join(homeDir, ".bb", "bin"),
      commandName: "bb",
      wrapperPath: join(homeDir, ".bb", "bin", "bb"),
    });

    const contents = await readFile(result.wrapperPath, "utf8");
    expect(contents).toContain(WRAPPER_MARKER);

    const mode = (await stat(result.wrapperPath)).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("leaves a pre-existing foreign file untouched and reports it", async () => {
    const wrapperPath = join(homeDir, ".bb", "bin", "bb");
    await mkdir(join(homeDir, ".bb", "bin"), { recursive: true });
    await writeFile(wrapperPath, "#!/bin/sh\necho not-ours\n");
    await chmod(wrapperPath, 0o644);

    await expect(
      runInstallCli({ cliPath, homeDir, platform: "darwin" }),
    ).rejects.toThrow(/was not written by bb/);

    const contents = await readFile(wrapperPath, "utf8");
    expect(contents).toBe("#!/bin/sh\necho not-ours\n");
    const mode = (await stat(wrapperPath)).mode & 0o777;
    expect(mode).toBe(0o644);
  });

  it("does not execute a command substitution embedded in the app bundle path", async () => {
    // This is the shell-injection regression: appBundlePath is interpolated
    // into the generated script's diagnostic line. It must go through the
    // single-quoting APP_BUNDLE assignment rather than being embedded raw, or
    // a bundle path containing a backtick / $() would execute at wrapper-run
    // time. Mirrors the equivalent test in
    // apps/desktop/test/cli-wrapper-script.test.ts.
    const markerFile = join(tempRoot, "pwned-marker");
    const injectedBundlePath = join(
      tempRoot,
      `bb\`touch ${markerFile}\`.app`,
    );
    await writeBundleBinEntries(injectedBundlePath, ["bb"]);
    const injectedCliPath = cliPathFor(injectedBundlePath);

    const result = await runInstallCli({
      cliPath: injectedCliPath,
      homeDir,
      platform: "darwin",
    });

    // Run the generated wrapper. It fails because the real in-bundle wrapper
    // doesn't exist (it's a bare bin/bb file with no #!/bin/sh exec target
    // behavior here), which is fine -- the point is whether the payload ran.
    try {
      execSync(`/bin/sh ${result.wrapperPath}`, { stdio: "pipe" });
    } catch {
      // Expected: the wrapper reports the app missing/not executable.
    }

    const markerExists = await stat(markerFile).then(
      () => true,
      () => false,
    );
    expect(markerExists).toBe(false);
  });

  it("reports a clear error on Linux instead of guessing a bundle", async () => {
    await expect(
      runInstallCli({ cliPath: "/irrelevant/bb", homeDir, platform: "linux" }),
    ).rejects.toThrow(/desktop app at launch/);
  });

  it("reports a clear error when not running from a packaged bundle", async () => {
    await expect(
      runInstallCli({
        cliPath: "/Users/x/.local/share/mise/installs/node/22/bin/bb",
        homeDir,
        platform: "darwin",
      }),
    ).rejects.toThrow(/not running from a packaged bb\.app/);
  });
});
