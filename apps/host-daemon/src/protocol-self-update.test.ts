import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import type { PackageManagerPreference } from "@bb/provider-bridge-protocol";
import type { MiseKitIo } from "@bb/provider-bridge-protocol/bridge-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDaemonLogger } from "./logger.js";
import {
  createProtocolSelfUpdater,
  PACKAGE_MANAGER_FILE_NAME,
  readPersistedPackageManager,
  SELF_UPDATE_INITIAL_RETRY_DELAY_MS,
  SELF_UPDATE_MAX_RETRY_DELAY_MS,
  writePersistedPackageManager,
} from "./protocol-self-update.js";

const roots: string[] = [];

function logger() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } satisfies HostDaemonLogger;
}

const SERVER_VERSION = "9.0.0-test";
const miseBinary = join("/", "Users", "test", ".local", "bin", "mise");
const miseInstallDir = join(
  "/",
  "Users",
  "test",
  ".local",
  "share",
  "mise",
  "installs",
  "npm-bb-app",
  "8.0.0",
);

function fakeMiseIo(args: {
  installed?: boolean;
  installDir?: string | null;
  versionsAfterUse?: string;
  onUse?: () => void;
}): MiseKitIo & { calls: string[][]; installedVersion: string } {
  const io = {
    calls: [] as string[][],
    installedVersion: "8.0.0",
    async commandStdout(command: string, commandArgs: readonly string[]) {
      io.calls.push([command, ...commandArgs]);
      if (command !== miseBinary || commandArgs[1] !== "ls") return null;
      if (args.installDir === null) return "[]";
      return JSON.stringify([
        {
          version: io.installedVersion,
          requested_version: io.installedVersion,
          install_path: args.installDir ?? miseInstallDir,
          installed: true,
          active: true,
        },
      ]);
    },
    async isExecutable(filePath: string) {
      return (args.installed ?? true) && filePath === miseBinary;
    },
    async realpath(filePath: string) {
      return filePath;
    },
    env: { PATH: "/usr/bin:/bin" },
    homeDir: join("/", "Users", "test"),
  };
  return io;
}

async function createFixture(
  args: {
    enabled?: boolean;
    protocolVersion?: number;
    installFailure?: Error;
    now?: () => number;
    serverUrl?: string;
    useDefaultInstaller?: boolean;
    packageManager?: PackageManagerPreference;
    bundlePath?: string;
    miseIo?: MiseKitIo;
    miseInstallsVersion?: string;
  } = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-self-update-test-"));
  roots.push(dataDir);
  const installTarball = vi.fn(async () => {
    if (args.installFailure) throw args.installFailure;
  });
  const runProcess = vi.fn(async (command: string, commandArgs: string[]) => {
    if (
      command === miseBinary &&
      commandArgs[0] === "use" &&
      args.miseIo !== undefined &&
      "installedVersion" in args.miseIo
    ) {
      args.miseIo.installedVersion = args.miseInstallsVersion ?? SERVER_VERSION;
    }
  });
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/install/version")) {
      return Response.json({
        version: SERVER_VERSION,
        protocolVersion:
          args.protocolVersion ?? HOST_DAEMON_PROTOCOL_VERSION + 1,
      });
    }
    if (url.endsWith("/install/bb-app.tgz")) {
      return new Response("tarball");
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  const testLogger = logger();
  const updater = createProtocolSelfUpdater({
    dataDir,
    enabled: args.enabled ?? true,
    fetchFn,
    ...(args.useDefaultInstaller || args.miseIo !== undefined
      ? { runProcess }
      : { installTarball }),
    logger: testLogger,
    now: args.now,
    serverUrl: args.serverUrl ?? "https://server.example.test",
    packageManager: args.packageManager,
    bundlePath: args.bundlePath ?? join(dataDir, "not-bb-app", "daemon.mjs"),
    miseIo: args.miseIo,
    shellPath: () => "/usr/bin:/bin",
  });
  return {
    dataDir,
    fetchFn,
    installTarball,
    logger: testLogger,
    runProcess,
    updater,
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("protocol self-update", () => {
  it("installs exactly once when the server protocol is newer and enabled", async () => {
    const test = await createFixture();
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    expect(test.fetchFn).toHaveBeenCalledTimes(2);
    expect(test.installTarball).toHaveBeenCalledOnce();
  });

  it("verifies and persists the server artifact digest", async () => {
    const test = await createFixture();
    const bytes = new TextEncoder().encode("verified-tarball");
    const digest = createHash("sha256").update(bytes).digest("hex");
    test.fetchFn.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/install/version")) {
        return Response.json({
          version: "9.0.0-test",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION + 1,
        });
      }
      return new Response(bytes, {
        headers: { "x-bb-artifact-sha256": digest },
      });
    });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    await expect(
      readFile(join(test.dataDir, "host-artifact.sha256"), "utf8"),
    ).resolves.toBe(`${digest}\n`);
    expect(test.installTarball).toHaveBeenCalledOnce();
  });

  it("rejects a downloaded artifact whose digest does not match", async () => {
    const test = await createFixture();
    test.fetchFn.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/install/version")) {
        return Response.json({
          version: "9.0.0-test",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION + 1,
        });
      }
      return new Response("tampered", {
        headers: { "x-bb-artifact-sha256": "a".repeat(64) },
      });
    });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");
    expect(test.installTarball).not.toHaveBeenCalled();
    expect(test.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("self-update failed"),
    );
  });

  it("skips downloading and reinstalling an identical installed artifact", async () => {
    const test = await createFixture();
    const digest = "b".repeat(64);
    await writeFile(join(test.dataDir, "host-artifact.sha256"), `${digest}\n`);
    test.fetchFn.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/install/version")) {
          return Response.json({
            version: "9.0.0-test",
            protocolVersion: HOST_DAEMON_PROTOCOL_VERSION + 1,
          });
        }
        expect(init?.headers).toEqual({
          "if-none-match": `"sha256-${digest}"`,
        });
        return new Response(null, {
          headers: { "x-bb-artifact-sha256": digest },
          status: 304,
        });
      },
    );

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    expect(test.installTarball).not.toHaveBeenCalled();
    expect(test.logger.info).toHaveBeenCalledWith(
      { artifactDigest: digest },
      expect.stringContaining("already installed"),
    );
  });

  it("finds npm beside the running Node executable when the service PATH omits it", async () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    const test = await createFixture({ useDefaultInstaller: true });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.runProcess).toHaveBeenCalledOnce();
    expect(test.runProcess).toHaveBeenCalledWith(
      "npm",
      [
        "install",
        "-g",
        "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher",
        expect.stringContaining("bb-app-update-"),
      ],
      {
        env: expect.objectContaining({
          PATH: `${dirname(process.execPath)}${delimiter}/usr/bin:/bin`,
        }),
      },
    );
  });

  it("updates an installer-managed bb-app inside its machine-specific prefix", async () => {
    vi.stubEnv("BB_APP_NPM_PREFIX", "/machine-data/npm");
    const test = await createFixture({ useDefaultInstaller: true });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.runProcess).toHaveBeenCalledWith(
      "npm",
      [
        "install",
        "-g",
        "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher",
        "--prefix",
        "/machine-data/npm",
        expect.stringContaining("bb-app-update-"),
      ],
      expect.any(Object),
    );
  });

  it("keeps legacy global updates when the installer prefix is blank", async () => {
    vi.stubEnv("BB_APP_NPM_PREFIX", " ");
    const test = await createFixture({ useDefaultInstaller: true });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.runProcess).toHaveBeenCalledWith(
      "npm",
      [
        "install",
        "-g",
        "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher",
        expect.stringContaining("bb-app-update-"),
      ],
      expect.any(Object),
    );
  });

  it("does nothing when auto-update is disabled", async () => {
    const test = await createFixture({ enabled: false });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "skipped",
    );
    expect(test.fetchFn).not.toHaveBeenCalled();
    expect(test.installTarball).not.toHaveBeenCalled();
  });

  it("refuses auto-update over non-loopback HTTP", async () => {
    const test = await createFixture({
      serverUrl: "http://server.example.test",
    });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");
    expect(test.fetchFn).not.toHaveBeenCalled();
    expect(test.installTarball).not.toHaveBeenCalled();
    expect(test.logger.error).toHaveBeenCalledWith(
      { serverUrl: "http://server.example.test" },
      expect.stringContaining("insecure transport"),
    );
  });

  it("allows auto-update over loopback HTTP", async () => {
    const test = await createFixture({ serverUrl: "http://127.0.0.1:38886" });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    expect(test.installTarball).toHaveBeenCalledOnce();
  });

  it("refuses equal protocol reinstalls and downgrades", async () => {
    for (const protocolVersion of [
      HOST_DAEMON_PROTOCOL_VERSION,
      HOST_DAEMON_PROTOCOL_VERSION - 1,
    ]) {
      const test = await createFixture({ protocolVersion });
      await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
        "skipped",
      );
      expect(test.installTarball).not.toHaveBeenCalled();
    }
  });

  it("persists a short exponential retry backoff capped at five minutes", async () => {
    let now = 10_000;
    const test = await createFixture({ now: () => now });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    now += SELF_UPDATE_INITIAL_RETRY_DELAY_MS - 1;
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "skipped",
    );
    expect(test.installTarball).toHaveBeenCalledOnce();

    now += 1;
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    expect(test.installTarball).toHaveBeenCalledTimes(2);

    for (let attemptCount = 2; attemptCount < 8; attemptCount += 1) {
      now += Math.min(
        SELF_UPDATE_INITIAL_RETRY_DELAY_MS * 2 ** (attemptCount - 1),
        SELF_UPDATE_MAX_RETRY_DELAY_MS,
      );
      await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
        "updated",
      );
    }

    now += SELF_UPDATE_MAX_RETRY_DELAY_MS - 1;
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "skipped",
    );
  });

  it("contains install failures and rate-limits their retry", async () => {
    const test = await createFixture({
      installFailure: new Error("npm failed"),
      now: () => 25_000,
    });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "skipped",
    );
    expect(test.installTarball).toHaveBeenCalledOnce();
    expect(test.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("self-update failed"),
    );
  });

  it("lets a user-requested retry bypass and reset the current backoff", async () => {
    let now = 25_000;
    const test = await createFixture({
      installFailure: new Error("download failed"),
      now: () => now,
    });
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "skipped",
    );

    await expect(
      test.updater.handleProtocolMismatch({ force: true }),
    ).resolves.toBe("failed");
    expect(test.installTarball).toHaveBeenCalledTimes(2);

    now += SELF_UPDATE_INITIAL_RETRY_DELAY_MS;
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");
    expect(test.installTarball).toHaveBeenCalledTimes(3);
  });

  it("tries immediately when the server advances to another protocol", async () => {
    let now = 30_000;
    let protocolVersion = HOST_DAEMON_PROTOCOL_VERSION + 1;
    const test = await createFixture({ now: () => now });
    test.fetchFn.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/install/version")) {
        return Response.json({ version: "test", protocolVersion });
      }
      return new Response("tarball");
    });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    protocolVersion += 1;
    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    expect(test.installTarball).toHaveBeenCalledTimes(2);
  });
});

async function createBbAppPackage(root: string): Promise<string> {
  const packageRoot = join(root, "lib", "node_modules", "bb-app");
  await mkdir(join(packageRoot, "host-daemon", "dist"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "bb-app", version: "8.0.0" }),
  );
  return join(packageRoot, "host-daemon", "dist", "daemon-bundle.mjs");
}

function expectMiseUse(
  runProcess: ReturnType<typeof vi.fn>,
  version = SERVER_VERSION,
) {
  expect(runProcess).toHaveBeenCalledOnce();
  expect(runProcess).toHaveBeenCalledWith(
    miseBinary,
    ["use", "-g", "-y", `npm:bb-app@${version}`],
    {
      env: expect.objectContaining({
        MISE_YES: "1",
        PATH: `${dirname(miseBinary)}${delimiter}/usr/bin:/bin`,
      }),
    },
  );
}

function expectNoNpm(runProcess: ReturnType<typeof vi.fn>) {
  for (const call of runProcess.mock.calls) {
    expect(call[0]).not.toBe("npm");
  }
}

describe("protocol self-update package-manager strategy", () => {
  it("keeps the npm tarball flow when BB_APP_NPM_PREFIX is set even with mise forced", async () => {
    vi.stubEnv("BB_APP_NPM_PREFIX", "/machine-data/npm");
    const miseIo = fakeMiseIo({});
    const test = await createFixture({ miseIo, packageManager: "mise" });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.fetchFn).toHaveBeenCalledTimes(2);
    expect(miseIo.calls).toEqual([]);
    expect(test.runProcess).toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["--prefix", "/machine-data/npm"]),
      expect.any(Object),
    );
  });

  it("installs through mise without downloading when mise is forced", async () => {
    const miseIo = fakeMiseIo({});
    const test = await createFixture({ miseIo, packageManager: "mise" });
    await writeFile(join(test.dataDir, "host-artifact.sha256"), "a".repeat(64));

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.fetchFn).toHaveBeenCalledTimes(1);
    expectMiseUse(test.runProcess);
    expectNoNpm(test.runProcess);
    await expect(
      readFile(join(test.dataDir, "host-artifact.sha256"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(test.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ serverVersion: SERVER_VERSION }),
      expect.stringContaining("through mise"),
    );
  });

  it("uses mise in auto mode when the running bb-app lives inside the mise install", async () => {
    const installRoot = await mkdtemp(join(tmpdir(), "bb-mise-install-"));
    roots.push(installRoot);
    const bundlePath = await createBbAppPackage(installRoot);
    const test = await createFixture({
      miseIo: fakeMiseIo({ installDir: installRoot }),
      packageManager: "auto",
      bundlePath,
    });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.fetchFn).toHaveBeenCalledTimes(1);
    expectMiseUse(test.runProcess);
    expectNoNpm(test.runProcess);
  });

  it("uses the tarball flow in auto mode when the running bb-app is not mise-managed", async () => {
    const miseIo = fakeMiseIo({});
    const test = await createFixture({ miseIo, packageManager: "auto" });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.fetchFn).toHaveBeenCalledTimes(2);
    expect(miseIo.calls).toEqual([
      [miseBinary, "-y", "ls", "--json", "npm:bb-app"],
    ]);
    expect(test.runProcess).toHaveBeenCalledOnce();
    expect(test.runProcess.mock.calls[0]?.[0]).toBe("npm");
  });

  it("uses the tarball flow when npm is forced even though mise manages bb-app", async () => {
    const miseIo = fakeMiseIo({});
    const installRoot = await mkdtemp(join(tmpdir(), "bb-mise-install-"));
    roots.push(installRoot);
    const bundlePath = await createBbAppPackage(installRoot);
    const test = await createFixture({
      miseIo,
      packageManager: "npm",
      bundlePath,
    });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(miseIo.calls).toEqual([]);
    expect(test.runProcess.mock.calls[0]?.[0]).toBe("npm");
  });

  it("reads the persisted server preference when no host override is set", async () => {
    const miseIo = fakeMiseIo({});
    const test = await createFixture({ miseIo });
    await writePersistedPackageManager(
      join(test.dataDir, PACKAGE_MANAGER_FILE_NAME),
      "mise",
    );
    await expect(
      readPersistedPackageManager(
        join(test.dataDir, PACKAGE_MANAGER_FILE_NAME),
      ),
    ).resolves.toBe("mise");

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expectMiseUse(test.runProcess);
    expectNoNpm(test.runProcess);
  });

  it("fails without an npm fallback when mise installs a different version", async () => {
    const miseIo = fakeMiseIo({});
    const test = await createFixture({
      miseIo,
      packageManager: "mise",
      miseInstallsVersion: "8.0.0",
    });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");

    expectMiseUse(test.runProcess);
    expectNoNpm(test.runProcess);
    expect(test.fetchFn).toHaveBeenCalledTimes(1);
    expect(test.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: expect.stringContaining(
            `mise use -g npm:bb-app@${SERVER_VERSION}`,
          ),
        }),
      }),
      expect.stringContaining("self-update failed"),
    );
  });

  it("fails without an npm fallback when the mise command errors", async () => {
    const miseIo = fakeMiseIo({});
    const test = await createFixture({ miseIo, packageManager: "mise" });
    test.runProcess.mockRejectedValueOnce(new Error("no versions found"));

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");

    expectNoNpm(test.runProcess);
    expect(test.fetchFn).toHaveBeenCalledTimes(1);
    expect(test.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: expect.stringContaining("is published to npm"),
        }),
      }),
      expect.stringContaining("self-update failed"),
    );
  });

  it("fails when mise is forced but no mise binary exists", async () => {
    const miseIo = fakeMiseIo({ installed: false });
    const test = await createFixture({ miseIo, packageManager: "mise" });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");

    expect(test.runProcess).not.toHaveBeenCalled();
    expect(test.fetchFn).toHaveBeenCalledTimes(1);
    expect(test.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          message: expect.stringContaining("no mise binary"),
        }),
      }),
      expect.stringContaining("self-update failed"),
    );
  });

  it("falls back to the tarball flow in auto mode when mise is absent", async () => {
    const miseIo = fakeMiseIo({ installed: false });
    const test = await createFixture({ miseIo, packageManager: "auto" });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );

    expect(test.fetchFn).toHaveBeenCalledTimes(2);
    expect(test.runProcess.mock.calls[0]?.[0]).toBe("npm");
  });
});
