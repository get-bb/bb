import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rmdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BB_CLI_BUNDLE_RELATIVE_CLI_PATH,
  BB_CLI_WRAPPER_MARKER,
  createAppImageBootstrapScript,
  createBundleCliWrapperScript,
  createHomeCliWrapperScript,
} from "../src/cli-wrapper-script.js";

describe("createBundleCliWrapperScript", () => {
  it("execs the bundle's own Electron as node against the bundled CLI", () => {
    const script = createBundleCliWrapperScript({
      commandName: "bb-nightly",
      macExecutableName: "bb Nightly",
    });

    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain(BB_CLI_WRAPPER_MARKER);
    expect(script).toContain('ELECTRON_RUN_AS_NODE=1');
    // The executable name contains a space, so every expansion must be quoted.
    expect(script).toContain('"$APP/Contents/MacOS/bb Nightly"');
    expect(script).toContain(BB_CLI_BUNDLE_RELATIVE_CLI_PATH);
  });

  it("stashes NODE_OPTIONS instead of discarding it", () => {
    // Electron prints a node_main.cc warning to stderr on every invocation when
    // NODE_OPTIONS is set, so it must be unset; the CLI re-applies BB_NODE_OPTIONS
    // to any node child it spawns, so it must not be lost.
    const script = createBundleCliWrapperScript({
      commandName: "bb",
      macExecutableName: "bb",
    });

    expect(script).toContain('BB_NODE_OPTIONS="$NODE_OPTIONS"');
    expect(script).toContain("unset NODE_OPTIONS");
  });

  it("walks symlinks by hand rather than calling realpath", () => {
    // macOS ships the BSD realpath(1), which has not always been present.
    const script = createBundleCliWrapperScript({
      commandName: "bb",
      macExecutableName: "bb",
    });

    expect(script).toContain("readlink");
    expect(script).not.toContain("realpath");
  });
});

describe("createHomeCliWrapperScript", () => {
  it("delegates to the macOS bundle wrapper and reports a missing app", () => {
    const script = createHomeCliWrapperScript({
      commandName: "bb",
      target: {
        kind: "macos-bundle",
        appBundlePath: "/Applications/bb.app",
        wrapperPath: "/Applications/bb.app/Contents/Resources/bin/bb",
      },
    });

    expect(script).toContain(BB_CLI_WRAPPER_MARKER);
    expect(script).toContain("'/Applications/bb.app/Contents/Resources/bin/bb'");
    // A dangling symlink would say "command not found" and send the user
    // looking in the wrong place; the wrapper names the real cause.
    // The diagnostic references the variable to prevent shell injection.
    expect(script).toContain("no longer installed at $APP_BUNDLE");
    expect(script).toContain("exit 127");
  });

  it("re-invokes the recorded AppImage through a bootstrap on Linux", () => {
    const script = createHomeCliWrapperScript({
      commandName: "bb",
      target: {
        kind: "linux-appimage",
        appImagePath: "/home/user/bb.AppImage",
        bootstrapPath: "/home/user/.bb/bin/bb-bootstrap.mjs",
      },
    });

    expect(script).toContain("ELECTRON_RUN_AS_NODE=1");
    expect(script).toContain("'/home/user/bb.AppImage'");
    expect(script).toContain("'/home/user/.bb/bin/bb-bootstrap.mjs'");
    // Diagnostics reference variables to prevent shell injection
    expect(script).toContain("no longer at $APPIMG");
    expect(script).toContain("missing bootstrap at $BOOTSTRAP");
    expect(script).toContain("exit 127");
  });

  it("quotes paths that contain spaces", () => {
    const script = createHomeCliWrapperScript({
      commandName: "bb-nightly",
      target: {
        kind: "macos-bundle",
        appBundlePath: "/Applications/bb Nightly.app",
        wrapperPath: "/Applications/bb Nightly.app/Contents/Resources/bin/bb-nightly",
      },
    });

    expect(script).toContain(
      "'/Applications/bb Nightly.app/Contents/Resources/bin/bb-nightly'",
    );
  });

  it("single-quotes paths to prevent shell expansion of $, backticks, and backslashes", () => {
    // Paths come from user-chosen locations: ~/Downloads/bb$(whoami).app is legal,
    // as is /Applications/bb`id`.app or /mnt/bb$2.app. Double quotes would expand
    // these at wrapper-run time. Single quotes are inert.
    const script = createHomeCliWrapperScript({
      commandName: "bb",
      target: {
        kind: "macos-bundle",
        appBundlePath: '/Applications/bb`id`.app',
        wrapperPath: '/Applications/bb$2.app/Contents/Resources/bin/bb',
      },
    });

    // The wrapperPath is assigned to WRAPPER with single quotes, preventing shell expansion
    expect(script).toContain("WRAPPER='/Applications/bb$2.app/Contents/Resources/bin/bb'");
    // If it were double-quoted, the $2 would be treated as a variable at runtime
    expect(script).not.toContain('WRAPPER="/Applications/bb$2');
  });

  it("does not execute command substitutions in paths", async () => {
    // Even though paths with backticks or $() are rare, the wrapper must handle
    // them safely. This test executes the generated shell script to verify that
    // a command substitution payload in appBundlePath does NOT execute.
    const tempDir = await mkdtemp(join(tmpdir(), "bb-wrapper-"));
    try {
      const markerFile = join(tempDir, "pwned-marker");
      const script = createHomeCliWrapperScript({
        commandName: "bb",
        target: {
          kind: "macos-bundle",
          appBundlePath: `/Applications/bb\`touch ${markerFile}\`.app`,
          wrapperPath: "/Applications/bb.app/Contents/Resources/bin/bb",
        },
      });

      const scriptFile = join(tempDir, "wrapper.sh");
      await writeFile(scriptFile, script);

      // Run the wrapper through /bin/sh. It will fail because the wrapper doesn't
      // exist, but the payload should not execute.
      try {
        execSync(`/bin/sh ${scriptFile}`, { stdio: "pipe" });
      } catch {
        // Expected: wrapper execution will fail
      }

      // If the payload had executed, markerFile would exist. It must not.
      const markerExists = await mkdir(markerFile, { recursive: true }).then(
        () => false,
        () => true,
      );
      expect(markerExists).toBe(false);
    } finally {
      await rmdir(tempDir, { recursive: true });
    }
  });
});

describe("createAppImageBootstrapScript", () => {
  it("imports the CLI out of the ephemeral APPDIR mount", () => {
    // APPDIR is the per-launch mount point, which is why the bootstrap has to
    // resolve at runtime instead of being baked into the wrapper.
    const script = createAppImageBootstrapScript();

    expect(script).toContain("process.env.APPDIR");
    expect(script).toContain(
      "resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb",
    );
  });
});
