import { describe, expect, it } from "vitest";
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
    expect(script).toContain('"/Applications/bb.app/Contents/Resources/bin/bb"');
    // A dangling symlink would say "command not found" and send the user
    // looking in the wrong place; the wrapper names the real cause.
    expect(script).toContain("no longer installed at /Applications/bb.app");
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
    expect(script).toContain('"/home/user/bb.AppImage"');
    expect(script).toContain('"/home/user/.bb/bin/bb-bootstrap.mjs"');
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
      '"/Applications/bb Nightly.app/Contents/Resources/bin/bb-nightly"',
    );
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
