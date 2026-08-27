import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BB_CLI_WRAPPER_MARKER } from "../src/cli-wrapper-script.js";
import {
  refreshHomeCliWrapper,
  resolveCliCommandName,
  resolveCliWrapperTarget,
  resolveHomeCliBinDir,
} from "../src/cli-link.js";

const silentLogger = { warn: () => {} };

let homeDir: string;

beforeEach(async () => {
  homeDir = await mkdtemp(resolve(tmpdir(), "bb-cli-link-"));
});

afterEach(async () => {
  await rm(homeDir, { force: true, recursive: true });
});

describe("resolveCliCommandName", () => {
  it("maps the channel product name to its command name", () => {
    // Matches the Linux executable policy in desktop-release-channel.mjs so
    // both channels can be installed side by side without shadowing.
    expect(resolveCliCommandName({ productName: "bb" })).toBe("bb");
    expect(resolveCliCommandName({ productName: "bb Nightly" })).toBe(
      "bb-nightly",
    );
  });
});

describe("resolveHomeCliBinDir", () => {
  it("anchors to $HOME rather than the configured data directory", () => {
    // The PATH line has to be a fixed string that survives a data-dir change.
    expect(resolveHomeCliBinDir({ homeDir: "/Users/x" })).toBe(
      "/Users/x/.bb/bin",
    );
  });
});

describe("resolveCliWrapperTarget", () => {
  it("points at the in-bundle wrapper on macOS", () => {
    const target = resolveCliWrapperTarget({
      commandName: "bb",
      env: {},
      homeDir: "/Users/x",
      platform: "darwin",
      resourcesPath: "/Applications/bb.app/Contents/Resources",
    });

    expect(target).toEqual({
      kind: "macos-bundle",
      appBundlePath: "/Applications/bb.app",
      wrapperPath: "/Applications/bb.app/Contents/Resources/bin/bb",
    });
  });

  it("records the stable AppImage path on Linux", () => {
    const target = resolveCliWrapperTarget({
      commandName: "bb",
      env: { APPIMAGE: "/home/user/bb.AppImage" },
      homeDir: "/home/user",
      platform: "linux",
      resourcesPath: "/tmp/.mount_bbXXXX/resources",
    });

    expect(target).toEqual({
      kind: "linux-appimage",
      appImagePath: "/home/user/bb.AppImage",
      bootstrapPath: "/home/user/.bb/bin/bb-bootstrap.mjs",
    });
  });

  it("returns null on Linux outside an AppImage", () => {
    // A linux-unpacked dir or a `--dir` build has no $APPIMAGE, so there is no
    // stable path to record and nothing should be written.
    expect(
      resolveCliWrapperTarget({
        commandName: "bb",
        env: {},
        homeDir: "/home/user",
        platform: "linux",
        resourcesPath: "/opt/bb/resources",
      }),
    ).toBeNull();
  });
});

describe("refreshHomeCliWrapper", () => {
  const macTarget = {
    kind: "macos-bundle",
    appBundlePath: "/Applications/bb.app",
    wrapperPath: "/Applications/bb.app/Contents/Resources/bin/bb",
  } as const;

  it("writes an executable wrapper on first launch", async () => {
    const status = await refreshHomeCliWrapper({
      commandName: "bb",
      homeDir,
      logger: silentLogger,
      target: macTarget,
    });

    const wrapperPath = join(homeDir, ".bb", "bin", "bb");
    expect(status).toEqual({ kind: "written", path: wrapperPath });
    expect(await readFile(wrapperPath, "utf8")).toContain(
      BB_CLI_WRAPPER_MARKER,
    );
    expect((await stat(wrapperPath)).mode & 0o777).toBe(0o755);
  });

  it("is idempotent across launches", async () => {
    await refreshHomeCliWrapper({
      commandName: "bb",
      homeDir,
      logger: silentLogger,
      target: macTarget,
    });
    const second = await refreshHomeCliWrapper({
      commandName: "bb",
      homeDir,
      logger: silentLogger,
      target: macTarget,
    });

    expect(second.kind).toBe("unchanged");
  });

  it("corrects a wrapper left over from a previous install location", async () => {
    const wrapperPath = join(homeDir, ".bb", "bin", "bb");
    await mkdir(join(homeDir, ".bb", "bin"), { recursive: true });
    await writeFile(
      wrapperPath,
      `#!/bin/sh\n${BB_CLI_WRAPPER_MARKER}\nexec "/Volumes/old/bb.app/Contents/Resources/bin/bb" "$@"\n`,
    );
    await chmod(wrapperPath, 0o755);

    const status = await refreshHomeCliWrapper({
      commandName: "bb",
      homeDir,
      logger: silentLogger,
      target: macTarget,
    });

    expect(status.kind).toBe("written");
    const contents = await readFile(wrapperPath, "utf8");
    expect(contents).toContain("/Applications/bb.app");
    expect(contents).not.toContain("/Volumes/old");
  });

  it("leaves a foreign file untouched and reports it", async () => {
    // A Homebrew or npm-global bb must never be clobbered.
    const wrapperPath = join(homeDir, ".bb", "bin", "bb");
    await mkdir(join(homeDir, ".bb", "bin"), { recursive: true });
    await writeFile(wrapperPath, "#!/bin/sh\necho not ours\n");

    const status = await refreshHomeCliWrapper({
      commandName: "bb",
      homeDir,
      logger: silentLogger,
      target: macTarget,
    });

    expect(status).toEqual({ kind: "foreign-file", path: wrapperPath });
    expect(await readFile(wrapperPath, "utf8")).toBe("#!/bin/sh\necho not ours\n");
  });

  it("writes the bootstrap alongside the wrapper on Linux", async () => {
    const status = await refreshHomeCliWrapper({
      commandName: "bb",
      homeDir,
      logger: silentLogger,
      target: {
        kind: "linux-appimage",
        appImagePath: "/home/user/bb.AppImage",
        bootstrapPath: join(homeDir, ".bb", "bin", "bb-bootstrap.mjs"),
      },
    });

    expect(status.kind).toBe("written");
    expect(
      await readFile(join(homeDir, ".bb", "bin", "bb-bootstrap.mjs"), "utf8"),
    ).toContain("process.env.APPDIR");
  });

  it("leaves a foreign bootstrap file untouched and reports it", async () => {
    // The bootstrap's marker is a JS comment (`// bb-managed: ...`), not the
    // shell-comment form used by the wrapper. A pre-existing, unmarked
    // bb-bootstrap.mjs must never be clobbered, and the wrapper itself must
    // not be written either.
    const bootstrapPath = join(homeDir, ".bb", "bin", "bb-bootstrap.mjs");
    const wrapperPath = join(homeDir, ".bb", "bin", "bb");
    await mkdir(join(homeDir, ".bb", "bin"), { recursive: true });
    await writeFile(bootstrapPath, "console.log('not ours');\n");

    const status = await refreshHomeCliWrapper({
      commandName: "bb",
      homeDir,
      logger: silentLogger,
      target: {
        kind: "linux-appimage",
        appImagePath: "/home/user/bb.AppImage",
        bootstrapPath,
      },
    });

    expect(status).toEqual({ kind: "foreign-file", path: bootstrapPath });
    expect(await readFile(bootstrapPath, "utf8")).toBe(
      "console.log('not ours');\n",
    );
    await expect(readFile(wrapperPath, "utf8")).rejects.toThrow();
  });
});
