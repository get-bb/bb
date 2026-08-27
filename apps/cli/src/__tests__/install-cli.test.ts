import { describe, expect, it } from "vitest";
import { resolveBundleFromCliPath } from "../commands/install-cli.js";

describe("resolveBundleFromCliPath", () => {
  it("walks up from the bundled CLI to the app bundle", () => {
    expect(
      resolveBundleFromCliPath({
        cliPath:
          "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb",
        platform: "darwin",
      }),
    ).toEqual({
      appBundlePath: "/Applications/bb.app",
      commandName: "bb",
      wrapperPath: "/Applications/bb.app/Contents/Resources/bin/bb",
    });
  });

  it("names the nightly command bb-nightly", () => {
    expect(
      resolveBundleFromCliPath({
        cliPath:
          "/Applications/bb Nightly.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb",
        platform: "darwin",
      })?.commandName,
    ).toBe("bb-nightly");
  });

  it("returns null for an npm-global install with no app bundle", () => {
    // `npm i -g bb-app` already puts bb on PATH by another route; there is no
    // bundle to link, so the command must say so rather than write a wrapper
    // pointing at nothing.
    expect(
      resolveBundleFromCliPath({
        cliPath: "/Users/x/.local/share/mise/installs/node/22/bin/bb",
        platform: "darwin",
      }),
    ).toBeNull();
  });

  it("returns null on Linux, where there is no in-bundle wrapper", () => {
    // An AppImage self-mounts at an ephemeral path, so ~/.bb/bin has to be
    // written by the app at launch from $APPIMAGE, not by the CLI.
    expect(
      resolveBundleFromCliPath({
        cliPath:
          "/tmp/.mount_bbXXXX/resources/app.asar.unpacked/node_modules/bb-app/host-daemon/dist/bb",
        platform: "linux",
      }),
    ).toBeNull();
  });
});
