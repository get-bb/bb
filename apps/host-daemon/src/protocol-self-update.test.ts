import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostDaemonLogger } from "./logger.js";
import {
  createProtocolSelfUpdater,
  SELF_UPDATE_INITIAL_RETRY_DELAY_MS,
  SELF_UPDATE_MAX_RETRY_DELAY_MS,
} from "./protocol-self-update.js";

const roots: string[] = [];
const TARBALL_BYTES = new TextEncoder().encode("tarball");

function tarballResponse(
  body: BodyInit,
  headers: Record<string, string> = {},
): Response {
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : null;
  return new Response(body, {
    headers: {
      "content-type": "application/gzip",
      ...(bytes === null
        ? {}
        : {
            "content-length": String(bytes.byteLength),
            "x-bb-artifact-sha256": createHash("sha256")
              .update(bytes)
              .digest("hex"),
          }),
      ...headers,
    },
  });
}

function versionResponse(): Response {
  return Response.json({
    version: "9.0.0-test",
    protocolVersion: HOST_DAEMON_PROTOCOL_VERSION + 1,
  });
}

async function expectNoDownloadLeftovers(dataDir: string): Promise<void> {
  expect(
    (await readdir(dataDir)).filter(
      (name) => name !== "host-daemon-update-attempt.json",
    ),
  ).toEqual([]);
}

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
    useDefaultInstaller?: boolean;
  } = {},
) {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-self-update-test-"));
  roots.push(dataDir);
  const installedTarballs: { bytes: string; path: string }[] = [];
  const installTarball = vi.fn(async (tarballPath: string) => {
    installedTarballs.push({
      bytes: await readFile(tarballPath, "utf8"),
      path: tarballPath,
    });
    if (args.installFailure) throw args.installFailure;
  });
  const runProcess = vi.fn(async () => undefined);
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
      return tarballResponse("tarball");
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  const testLogger = logger();
  const updater = createProtocolSelfUpdater({
    dataDir,
    enabled: args.enabled ?? true,
    fetchFn,
    ...(args.useDefaultInstaller ? { runProcess } : { installTarball }),
    logger: testLogger,
    now: args.now,
    serverUrl: args.serverUrl ?? "https://server.example.test",
  });
  return {
    dataDir,
    fetchFn,
    installedTarballs,
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
      if (String(input).endsWith("/install/version")) return versionResponse();
      return tarballResponse("verified-tarball");
    });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    await expect(
      readFile(join(test.dataDir, "host-artifact.sha256"), "utf8"),
    ).resolves.toBe(`${digest}\n`);
    expect(test.installedTarballs).toEqual([
      {
        bytes: "verified-tarball",
        path: join(test.dataDir, "host-package-download", "bb-app.tgz"),
      },
    ]);
    await expect(readdir(test.dataDir)).resolves.toEqual(
      expect.not.arrayContaining(["host-package-download"]),
    );
  });

  it.each([
    {
      name: "a digest mismatch",
      response: () =>
        tarballResponse("tampered", {
          "x-bb-artifact-sha256": "a".repeat(64),
        }),
      error: /content hash mismatch/u,
    },
    {
      name: "a missing digest header",
      response: () =>
        new Response(TARBALL_BYTES, {
          headers: { "content-length": String(TARBALL_BYTES.byteLength) },
        }),
      error: /x-bb-artifact-sha256/u,
    },
    {
      name: "a body longer than its content-length",
      response: () => tarballResponse("tarball", { "content-length": "3" }),
      error: /size mismatch: expected 3 bytes/u,
    },
    {
      name: "a body shorter than its content-length",
      response: () => tarballResponse("tarball", { "content-length": "4096" }),
      error: /size mismatch: expected 4096 bytes, received 7/u,
    },
    {
      name: "an interrupted body",
      response: () => {
        const digest = createHash("sha256").update(TARBALL_BYTES).digest("hex");
        return tarballResponse(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(TARBALL_BYTES.subarray(0, 3));
            },
            pull(controller) {
              controller.error(new Error("connection reset"));
            },
          }),
          { "x-bb-artifact-sha256": digest },
        );
      },
      error: /connection reset/u,
    },
  ])("rejects $name without installing or leaving files", async (testCase) => {
    const test = await createFixture();
    test.fetchFn.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/install/version")) return versionResponse();
      return testCase.response();
    });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");
    expect(test.installTarball).not.toHaveBeenCalled();
    expect(test.logger.error).toHaveBeenCalledWith(
      {
        err: expect.objectContaining({
          message: expect.stringMatching(testCase.error),
        }),
      },
      expect.stringContaining("self-update failed"),
    );
    await expectNoDownloadLeftovers(test.dataDir);
  });

  it("refuses an oversized package before reading its body", async () => {
    const test = await createFixture();
    let pulls = 0;
    const cancel = vi.fn();
    test.fetchFn.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/install/version")) return versionResponse();
      return tarballResponse(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
          cancel,
        }),
        {
          "content-length": String(2 * 1024 * 1024 * 1024),
          "x-bb-artifact-sha256": "d".repeat(64),
        },
      );
    });

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe("failed");
    expect(test.installTarball).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBeLessThanOrEqual(1);
    await expectNoDownloadLeftovers(test.dataDir);
  });

  it("clears a download left behind by an interrupted earlier attempt", async () => {
    const test = await createFixture();
    const staleDir = join(test.dataDir, "host-package-download");
    await mkdir(staleDir);
    await writeFile(join(staleDir, "bb-app.tgz.partial"), "stale");

    await expect(test.updater.handleProtocolMismatch()).resolves.toBe(
      "updated",
    );
    expect(test.installedTarballs.map((entry) => entry.bytes)).toEqual([
      "tarball",
    ]);
    await expect(readdir(test.dataDir)).resolves.toEqual(
      expect.not.arrayContaining(["host-package-download"]),
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
      process.execPath,
      [
        expect.stringMatching(/npm-cli\.js$/u),
        "install",
        "-g",
        "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher",
        expect.stringMatching(/host-package-download[/\\]bb-app\.tgz$/u),
      ],
      {
        env: expect.objectContaining({
          PATH: expect.stringContaining(
            `${dirname(process.execPath)}${delimiter}/usr/bin:/bin`,
          ),
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
      process.execPath,
      [
        expect.stringMatching(/npm-cli\.js$/u),
        "install",
        "-g",
        "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher",
        "--prefix",
        "/machine-data/npm",
        expect.stringMatching(/host-package-download[/\\]bb-app\.tgz$/u),
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
      process.execPath,
      [
        expect.stringMatching(/npm-cli\.js$/u),
        "install",
        "-g",
        "--allow-scripts=better-sqlite3,node-pty,@parcel/watcher",
        expect.stringMatching(/host-package-download[/\\]bb-app\.tgz$/u),
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
      return tarballResponse("tarball");
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
