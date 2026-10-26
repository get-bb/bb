import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDaemonLogger } from "./logger.js";
import {
  createProtocolSelfUpdater,
  defaultInstallTarball,
  defaultRunProcess,
  SELF_UPDATE_INITIAL_RETRY_DELAY_MS,
  SELF_UPDATE_MAX_RETRY_DELAY_MS,
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

async function createFixture(
  args: {
    enabled?: boolean;
    protocolVersion?: number;
    installFailure?: Error;
    now?: () => number;
    serverUrl?: string;
  } = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-self-update-test-"));
  roots.push(dataDir);
  const installTarball = vi.fn(async () => {
    if (args.installFailure) throw args.installFailure;
  });
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/install/version")) {
      return Response.json({
        version: "9.0.0-test",
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
    installTarball,
    logger: testLogger,
    now: args.now,
    serverUrl: args.serverUrl ?? "https://server.example.test",
  });
  return {
    dataDir,
    fetchFn,
    installTarball,
    logger: testLogger,
    updater,
  };
}

async function createNodeInstall(args: { npmCli: boolean }) {
  const root = await mkdtemp(join(tmpdir(), "bb-self-update-node-"));
  roots.push(root);
  const nodeExecPath =
    process.platform === "win32"
      ? join(root, "node.exe")
      : join(root, "bin", "node");
  const npmCliPath =
    process.platform === "win32"
      ? join(root, "node_modules", "npm", "bin", "npm-cli.js")
      : join(root, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  await mkdir(dirname(nodeExecPath), { recursive: true });
  if (args.npmCli) {
    await mkdir(dirname(npmCliPath), { recursive: true });
    await writeFile(npmCliPath, "");
  }
  return { nodeExecPath, npmCliPath, root };
}

const ALLOW_SCRIPTS_ARG =
  "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher";
const TARBALL_PATH = join(tmpdir(), "bb-app-update-test.tgz");

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

describe("default tarball installer", () => {
  it("runs the npm CLI installed with the running Node, not an npm found on PATH", async () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    vi.stubEnv("BB_APP_NPM_PREFIX", "");
    const node = await createNodeInstall({ npmCli: true });
    const runProcess = vi.fn(async () => undefined);

    await defaultInstallTarball(TARBALL_PATH, runProcess, node.nodeExecPath);

    expect(runProcess).toHaveBeenCalledOnce();
    expect(runProcess).toHaveBeenCalledWith(
      node.nodeExecPath,
      [node.npmCliPath, "install", "-g", ALLOW_SCRIPTS_ARG, TARBALL_PATH],
      {
        env: expect.objectContaining({
          PATH: `${dirname(node.nodeExecPath)}${delimiter}/usr/bin:/bin`,
        }),
      },
    );
  });

  it("falls back to npm on PATH, searched beside Node first, when that Node install has no npm CLI", async () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    vi.stubEnv("BB_APP_NPM_PREFIX", "");
    const node = await createNodeInstall({ npmCli: false });
    const runProcess = vi.fn(async () => undefined);

    await defaultInstallTarball(TARBALL_PATH, runProcess, node.nodeExecPath);

    expect(runProcess).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", ALLOW_SCRIPTS_ARG, TARBALL_PATH],
      {
        env: expect.objectContaining({
          PATH: `${dirname(node.nodeExecPath)}${delimiter}/usr/bin:/bin`,
        }),
      },
    );
  });

  it("updates an installer-managed bb-app inside its machine-specific prefix", async () => {
    vi.stubEnv("BB_APP_NPM_PREFIX", "/machine-data/npm");
    const node = await createNodeInstall({ npmCli: true });
    const runProcess = vi.fn(async () => undefined);

    await defaultInstallTarball(TARBALL_PATH, runProcess, node.nodeExecPath);

    expect(runProcess).toHaveBeenCalledWith(
      node.nodeExecPath,
      [
        node.npmCliPath,
        "install",
        "-g",
        ALLOW_SCRIPTS_ARG,
        "--prefix",
        "/machine-data/npm",
        TARBALL_PATH,
      ],
      expect.any(Object),
    );
  });

  it("keeps legacy global updates when the installer prefix is blank", async () => {
    vi.stubEnv("BB_APP_NPM_PREFIX", " ");
    const node = await createNodeInstall({ npmCli: true });
    const runProcess = vi.fn(async () => undefined);

    await defaultInstallTarball(TARBALL_PATH, runProcess, node.nodeExecPath);

    expect(runProcess).toHaveBeenCalledWith(
      node.nodeExecPath,
      [node.npmCliPath, "install", "-g", ALLOW_SCRIPTS_ARG, TARBALL_PATH],
      expect.any(Object),
    );
  });

  it.skipIf(process.platform === "win32")(
    "installs when the npm wrapper beside Node fails after installing, as mise's does without mise on PATH",
    async () => {
      const node = await createNodeInstall({ npmCli: true });
      const prefix = join(node.root, "prefix");
      vi.stubEnv("PATH", "/usr/bin:/bin");
      vi.stubEnv("BB_APP_NPM_PREFIX", prefix);
      const argvPath = join(node.root, "npm-argv.json");
      await symlink(process.execPath, node.nodeExecPath);
      await writeFile(
        join(dirname(node.nodeExecPath), "npm"),
        "#!/bin/sh\necho 'mise: command not found' >&2\nexit 127\n",
        { mode: 0o755 },
      );
      await writeFile(
        node.npmCliPath,
        `require("node:fs").writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));\n`,
      );

      await defaultInstallTarball(
        TARBALL_PATH,
        defaultRunProcess,
        node.nodeExecPath,
      );

      expect(JSON.parse(await readFile(argvPath, "utf8"))).toEqual([
        "install",
        "-g",
        ALLOW_SCRIPTS_ARG,
        "--prefix",
        prefix,
        TARBALL_PATH,
      ]);
    },
  );
});
