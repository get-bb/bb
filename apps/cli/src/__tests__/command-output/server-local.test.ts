import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  readServerImportFile,
  readServerMovedFile,
  SERVER_IMPORT_FILE_NAME,
  SERVER_MOVED_FILE_NAME,
  type ServerArchiveEncryption,
  type ServerMovedFile,
  writeServerArchive,
  writeServerMovedFile,
} from "@bb/server-archive";
import {
  collectLogPayloads,
  readlineMocks,
  runCommand,
  setupCommandOutputTestEnvironment,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerServerCommands } from "../../commands/server.js";
import { isNewerBbVersion } from "../../commands/server-local.js";

const PASSPHRASE = "correct horse battery staple";
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeDataFile(
  root: string,
  relativePath: string,
  body: string,
): Promise<string> {
  const path = join(root, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return path;
}

async function buildArchive(
  encryption: ServerArchiveEncryption | null,
  bbVersion = "0.50.0",
): Promise<string> {
  const sourceDataDir = await makeTempDir("bb-cli-server-source-");
  const files = [
    { archivePath: "bb.db", body: "sqlite database" },
    {
      archivePath: "config.json",
      body: JSON.stringify({ config: { BB_LOG_LEVEL: "debug" } }),
    },
    { archivePath: "auth-secret", body: "secret" },
    { archivePath: "attachments/thr_1/image.png", body: "png" },
    { archivePath: "plugins/tasks/data.db", body: "plugin database" },
  ];
  const sourceFiles = await Promise.all(
    files.map(async (file) => ({
      archivePath: file.archivePath,
      sourcePath: await writeDataFile(
        sourceDataDir,
        file.archivePath,
        file.body,
      ),
    })),
  );
  const outPath = join(
    await makeTempDir("bb-cli-server-archive-"),
    encryption === null ? "export.tar.gz" : "export.bbsa",
  );
  await writeServerArchive({
    outPath,
    files: sourceFiles,
    manifest: {
      createdAt: 1_700_000_000_000,
      bbVersion,
      protocolVersion: 209,
      migrationCount: 150,
      sourceDataDir: "/home/old/.bb",
      sourceServerHostId: "host-old-server",
    },
    encryption,
  });
  return outPath;
}

function tarHeader(path: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  const field = (offset: number, length: number, value: string): void => {
    header.write(value, offset, length, "utf8");
  };
  const octal = (value: number, length: number): string =>
    `${value.toString(8).padStart(length - 1, "0")}\0`;
  field(0, 100, path);
  field(100, 8, octal(0o600, 8));
  field(108, 8, octal(0, 8));
  field(116, 8, octal(0, 8));
  field(124, 12, octal(size, 12));
  field(136, 12, octal(0, 12));
  field(148, 8, "        ");
  field(156, 1, "0");
  field(257, 6, "ustar\0");
  field(263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  field(148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

function tarEntry(path: string, body: Buffer): Buffer {
  return Buffer.concat([
    tarHeader(path, body.length),
    body,
    Buffer.alloc((512 - (body.length % 512)) % 512),
  ]);
}

async function writeCraftedArchive(
  files: ReadonlyArray<{ path: string; body: string }>,
): Promise<string> {
  const manifest = Buffer.from(
    JSON.stringify({
      format: "bb-server-archive",
      version: 1,
      createdAt: 1_700_000_000_000,
      bbVersion: "0.50.0",
      protocolVersion: 209,
      migrationCount: 150,
      sourceDataDir: "/home/old/.bb",
      sourceServerHostId: "host-old-server",
      entries: files.map((file) => ({
        path: file.path,
        size: Buffer.byteLength(file.body),
        sha256: createHash("sha256").update(file.body).digest("hex"),
      })),
    }),
  );
  const archive = gzipSync(
    Buffer.concat([
      tarEntry("manifest.json", manifest),
      ...files.map((file) =>
        tarEntry(`files/${file.path}`, Buffer.from(file.body)),
      ),
      Buffer.alloc(1024),
    ]),
  );
  const outPath = join(
    await makeTempDir("bb-cli-server-archive-"),
    "crafted.tar.gz",
  );
  await writeFile(outPath, archive);
  return outPath;
}

function movedLock(overrides: Partial<ServerMovedFile> = {}): ServerMovedFile {
  return {
    version: 1,
    moveId: "move-1",
    movedAt: 1_700_000_000_000,
    fromHostId: "host-laptop",
    toHostId: "host-desktop",
    toHostName: "desktop",
    serverUrl: "https://me.getbb.app",
    mode: "connect",
    connectHandle: "me",
    oldCopyEntries: ["bb.db", "attachments", "plugins/tasks/data.db"],
    ...overrides,
  };
}

const register: CommandRegistrar = (program) =>
  registerServerCommands(
    program.enablePositionalOptions(),
    () => "http://server",
  );

let plainArchive: string;
let encryptedArchive: string;

beforeAll(async () => {
  plainArchive = await buildArchive(null);
  encryptedArchive = await buildArchive({
    kind: "passphrase",
    passphrase: PASSPHRASE,
  });
}, 60_000);

afterAll(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("bb server import", () => {
  setupCommandOutputTestEnvironment();

  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      createdDirs
        .splice(0)
        .map((dir) => rm(dir, { force: true, recursive: true })),
    );
  });

  async function makeDataDirParent(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "bb-cli-server-import-"));
    createdDirs.push(dir);
    return dir;
  }

  beforeEach(() => {
    vi.stubEnv("BB_APP_VERSION", "0.50.0");
  });

  it("installs a plain export and marks it for a manual import boot", async () => {
    const parent = await makeDataDirParent();
    const dataDir = join(parent, "bb-data");
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_500_000);

    await runCommand(
      ["server", "import", plainArchive, "--data-dir", dataDir, "--yes"],
      register,
    );

    expect(await readFile(join(dataDir, "bb.db"), "utf8")).toBe(
      "sqlite database",
    );
    expect(
      await readFile(
        join(dataDir, "attachments", "thr_1", "image.png"),
        "utf8",
      ),
    ).toBe("png");
    expect(
      await readFile(join(dataDir, "plugins", "tasks", "data.db"), "utf8"),
    ).toBe("plugin database");
    const marker = await readServerImportFile(dataDir);
    expect(marker).toEqual({
      version: 1,
      kind: "manual",
      moveId: null,
      activationToken: null,
      sourceDataDir: "/home/old/.bb",
      sourceServerHostId: "host-old-server",
      targetHostId: null,
      serverUrl: null,
      importedEntries: expect.arrayContaining([
        "bb.db",
        "config.json",
        "auth-secret",
        "attachments/thr_1/image.png",
        "plugins/tasks/data.db",
      ]),
      createdAt: 1_700_000_500_000,
      fixupsAppliedAt: null,
    });
    expect(await readdir(parent)).toEqual(["bb-data"]);
    const output = collectLogPayloads(vi.mocked(console.log));
    expect(output[0]).toBe(
      `Imported the bb server into ${dataDir} (5 files from /home/old/.bb, exported by bb 0.50.0).`,
    );
    expect(output).toContain(
      "Stop the original bb server before you start this one. Two servers holding the same bb connect credential take each other's tunnel.",
    );
    expect(output.at(-1)).toBe(
      `Then start it with npx bb-app --data-dir ${dataDir}.`,
    );
  });

  it("decrypts a passphrase export with the passphrase from the environment", async () => {
    const dataDir = join(await makeDataDirParent(), "bb-data");
    vi.stubEnv("BB_SERVER_EXPORT_PASSPHRASE", PASSPHRASE);

    await runCommand(
      [
        "server",
        "import",
        encryptedArchive,
        "--data-dir",
        dataDir,
        "--yes",
        "--json",
      ],
      register,
    );

    expect(await readFile(join(dataDir, "auth-secret"), "utf8")).toBe("secret");
    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!),
    ).toMatchObject({
      dataDir,
      bbVersion: "0.50.0",
      sourceServerHostId: "host-old-server",
    });
  });

  it("leaves the data directory without server files when the passphrase is wrong", async () => {
    const parent = await makeDataDirParent();
    const dataDir = join(parent, "bb-data");
    await mkdir(dataDir);
    await writeFile(join(dataDir, "host-id"), "host-desktop");
    vi.stubEnv("BB_SERVER_EXPORT_PASSPHRASE", "wrong passphrase");

    await expect(
      runCommand(
        ["server", "import", encryptedArchive, "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: Archive passphrase is incorrect",
    ]);
    expect(await readdir(dataDir)).toEqual(["host-id"]);
    expect(await readdir(parent)).toEqual(["bb-data"]);
  });

  it("refuses an encrypted export without a passphrase source", async () => {
    const dataDir = join(await makeDataDirParent(), "bb-data");
    vi.stubEnv("BB_SERVER_EXPORT_PASSPHRASE", undefined);
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    await expect(
      runCommand(
        ["server", "import", encryptedArchive, "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: This export is encrypted. Set BB_SERVER_EXPORT_PASSPHRASE or run this command in an interactive terminal to enter its passphrase.",
    ]);
    await expect(stat(join(dataDir, "bb.db"))).rejects.toThrow();
  });

  it("refuses a data directory that already has a server database", async () => {
    const dataDir = join(await makeDataDirParent(), "bb-data");
    await writeDataFile(dataDir, "bb.db", "existing server");

    await expect(
      runCommand(
        ["server", "import", plainArchive, "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))[0]).toBe(
      `Error: ${dataDir} already has a bb server database (bb.db). Import into a data directory without a server, such as --data-dir ~/.bb-imported.`,
    );
    expect(await readFile(join(dataDir, "bb.db"), "utf8")).toBe(
      "existing server",
    );
    expect(await readServerImportFile(dataDir)).toBeNull();
  });

  it("refuses while bb is running from the data directory", async () => {
    const dataDir = join(await makeDataDirParent(), "bb-data");
    await writeDataFile(
      dataDir,
      "bb-app-runtime.json",
      JSON.stringify({
        entryPath: "/usr/lib/bb-app/dist/launcher.js",
        pid: process.pid,
        surface: "cli",
        serverUrl: "http://127.0.0.1:38886",
        startedAt: new Date().toISOString(),
        version: "0.50.0",
      }),
    );

    await expect(
      runCommand(
        ["server", "import", plainArchive, "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))[0]).toBe(
      `Error: bb is running from ${dataDir} (pid ${String(process.pid)}). Stop it with bb-app stop or quit the desktop app, then try again.`,
    );
    await expect(stat(join(dataDir, "bb.db"))).rejects.toThrow();
  });

  it("imports past a stale runtime record whose process has exited", async () => {
    const dataDir = join(await makeDataDirParent(), "bb-data");
    await writeDataFile(
      dataDir,
      "bb-app-runtime.json",
      JSON.stringify({
        entryPath: "/usr/lib/bb-app/dist/launcher.js",
        pid: 2_147_483_646,
        surface: "cli",
        serverUrl: "http://127.0.0.1:38886",
        startedAt: new Date().toISOString(),
        version: "0.50.0",
      }),
    );

    await runCommand(
      ["server", "import", plainArchive, "--data-dir", dataDir, "--yes"],
      register,
    );

    expect(await readServerImportFile(dataDir)).not.toBeNull();
  });

  it("changes nothing when the confirmation is declined", async () => {
    const parent = await makeDataDirParent();
    const dataDir = join(parent, "bb-data");
    readlineMocks.question.mockResolvedValue("n");

    await runCommand(
      ["server", "import", plainArchive, "--data-dir", dataDir],
      register,
    );

    expect(readlineMocks.question).toHaveBeenCalledWith(
      `Import the bb server from ${plainArchive} into ${dataDir}? [y/N] `,
    );
    expect(await readdir(parent)).toEqual([]);
  });

  it("refuses a move archive encrypted with a raw key", async () => {
    const keyArchive = await buildArchive({
      kind: "key",
      key: randomBytes(32),
    });
    const dataDir = join(await makeDataDirParent(), "bb-data");

    await expect(
      runCommand(
        ["server", "import", keyArchive, "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))[0]).toBe(
      `Error: ${keyArchive} was created for a server move and can only be installed by that move. Create an export with bb server export.`,
    );
  });

  it("rejects a file that is not a server archive", async () => {
    const parent = await makeDataDirParent();
    const notAnArchive = await writeDataFile(parent, "notes.txt", "hello");
    const dataDir = join(parent, "bb-data");

    await expect(
      runCommand(
        ["server", "import", notAnArchive, "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: File is not a bb server archive",
    ]);
  });

  it("refuses an export made by a newer bb and leaves nothing behind", async () => {
    const newerArchive = await buildArchive(null, "0.51.0");
    const parent = await makeDataDirParent();
    const dataDir = join(parent, "bb-data");

    await expect(
      runCommand(
        ["server", "import", newerArchive, "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: This export came from bb 0.51.0; install that version or newer before importing.",
    ]);
    expect(await readdir(parent)).toEqual([]);
  });

  it("removes the pre-import config backups once the import is marked", async () => {
    const dataDir = join(await makeDataDirParent(), "bb-data");
    await writeDataFile(
      dataDir,
      "config.json",
      JSON.stringify({ config: { BB_APP_URL: "https://desktop.ts.net" } }),
    );

    await runCommand(
      ["server", "import", plainArchive, "--data-dir", dataDir, "--yes"],
      register,
    );

    expect(await readServerImportFile(dataDir)).not.toBeNull();
    expect(await readdir(dataDir)).not.toContain("server-import-backup");
    expect(
      JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")),
    ).toEqual({
      config: { BB_APP_URL: "https://desktop.ts.net", BB_LOG_LEVEL: "debug" },
    });
  });

  it("refuses an archive that carries host-owned files", async () => {
    const hostileArchive = await writeCraftedArchive([
      { path: "bb.db", body: "sqlite database" },
      { path: "host-id", body: "host-attacker" },
    ]);
    const parent = await makeDataDirParent();
    const dataDir = join(parent, "bb-data");

    await expect(
      runCommand(
        ["server", "import", hostileArchive, "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      `Error: Refusing to import ${hostileArchive}: Archive entry "host-id" is not a server-owned path. Nothing was imported.`,
    ]);
    expect(await readdir(parent)).toEqual([]);
  });
});

describe("isNewerBbVersion", () => {
  it.each([
    ["0.51.0", "0.50.0", true],
    ["0.50.0", "0.50.0", false],
    ["0.49.9", "0.50.0", false],
    ["1.0.0", "0.99.99", true],
    ["0.50.0", "0.50.0-beta.2", true],
    ["0.50.0-beta.2", "0.50.0", false],
    ["0.50.0-beta.10", "0.50.0-beta.2", true],
    ["0.50.0-rc.1", "0.50.0-beta.9", true],
    ["0.50.0-beta", "0.50.0-beta.1", false],
    ["not-a-version", "0.50.0", false],
  ] as const)("%s newer than %s is %s", (candidate, current, expected) => {
    expect(isNewerBbVersion(candidate, current)).toBe(expected);
  });
});

describe("bb server unlock", () => {
  setupCommandOutputTestEnvironment();

  beforeEach(() => {
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new TypeError("fetch failed"),
    );
  });

  function healthResponse(status: number, body: object): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("refuses while the new server still answers its health check", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(dataDir, movedLock());
    const configPath = await writeDataFile(
      dataDir,
      "config.json",
      JSON.stringify({ serverUrl: "https://me.getbb.app" }),
    );
    vi.mocked(globalThis.fetch).mockResolvedValue(
      healthResponse(200, { ok: true, launchId: "launch-1" }),
    );

    await expect(
      runCommand(
        ["server", "unlock", "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      "https://me.getbb.app/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: The server at https://me.getbb.app is running. Unlocking now would run two servers with the same data and bb connect credential. Stop it first, or pass --force.",
    ]);
    expect(await readServerMovedFile(dataDir)).not.toBeNull();
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      serverUrl: "https://me.getbb.app",
    });
  });

  it("--force unlocks without probing the new server", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(dataDir, movedLock());
    vi.mocked(globalThis.fetch).mockResolvedValue(
      healthResponse(200, { ok: true }),
    );

    await runCommand(
      ["server", "unlock", "--data-dir", dataDir, "--yes", "--force"],
      register,
    );

    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    expect(await readServerMovedFile(dataDir)).toBeNull();
  });

  it.each([
    [
      "the moved responder answers 410",
      () =>
        Promise.resolve(
          healthResponse(410, {
            code: "server_moved",
            message: "This bb server moved",
            details: {
              serverUrl: "https://me.getbb.app",
              toHostName: "desktop",
              movedAt: 1,
            },
          }),
        ),
    ],
    [
      "the new server is still pending",
      () =>
        Promise.resolve(
          healthResponse(200, {
            ok: true,
            serverMove: { state: "pending", moveId: "move-1" },
          }),
        ),
    ],
    [
      "the connection is refused",
      () => Promise.reject(new TypeError("fetch failed")),
    ],
    [
      "the health check times out",
      () =>
        Promise.reject(
          new DOMException(
            "The operation was aborted due to timeout",
            "TimeoutError",
          ),
        ),
    ],
  ])("unlocks when %s", async (_label, respond) => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(dataDir, movedLock());
    vi.mocked(globalThis.fetch).mockImplementation(respond);

    await runCommand(
      ["server", "unlock", "--data-dir", dataDir, "--yes"],
      register,
    );

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledOnce();
    expect(await readServerMovedFile(dataDir)).toBeNull();
  });

  const connectGrantConfig = {
    config: { BB_LOG_LEVEL: "debug" },
    serverUrl: "https://me.getbb.app",
    serverHeaders: { "x-bb-connect-machine": "grant-secret" },
  };

  async function writeConnectLockWithGrant(): Promise<{
    dataDir: string;
    configPath: string;
  }> {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(dataDir, movedLock({ mode: "connect" }));
    const configPath = await writeDataFile(
      dataDir,
      "config.json",
      JSON.stringify(connectGrantConfig),
    );
    return { dataDir, configPath };
  }

  it("probes a connect-mode server through the machine grant and refuses when it answers", async () => {
    const { dataDir, configPath } = await writeConnectLockWithGrant();
    vi.mocked(globalThis.fetch).mockResolvedValue(
      healthResponse(200, { version: "0.50.0" }),
    );

    await expect(
      runCommand(
        ["server", "unlock", "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledOnce();
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      "https://me.getbb.app/api/v1/system/version",
      expect.objectContaining({
        headers: { "x-bb-connect-machine": "grant-secret" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: The server at https://me.getbb.app is running. Unlocking now would run two servers with the same data and bb connect credential. Stop it first, or pass --force.",
    ]);
    expect(await readServerMovedFile(dataDir)).not.toBeNull();
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(
      connectGrantConfig,
    );
  });

  it.each([
    [
      "the gate reports the tunnel offline",
      () =>
        Promise.resolve(
          new Response("bb connect: tunnel offline\n", {
            status: 503,
            headers: { "x-bb-tunnel-offline": "1" },
          }),
        ),
    ],
    [
      "the connection is refused",
      () => Promise.reject(new TypeError("fetch failed")),
    ],
    [
      "the grant probe times out",
      () =>
        Promise.reject(
          new DOMException(
            "The operation was aborted due to timeout",
            "TimeoutError",
          ),
        ),
    ],
  ])(
    "unlocks a connect-mode copy without a note when %s, then drops the grant",
    async (_label, respond) => {
      const { dataDir, configPath } = await writeConnectLockWithGrant();
      vi.mocked(globalThis.fetch).mockImplementation(respond);

      await runCommand(
        ["server", "unlock", "--data-dir", dataDir, "--yes"],
        register,
      );

      expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
        "https://me.getbb.app/api/v1/system/version",
        expect.anything(),
      );
      expect(await readServerMovedFile(dataDir)).toBeNull();
      expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
        config: { BB_LOG_LEVEL: "debug" },
      });
      expect(
        collectLogPayloads(vi.mocked(console.error)).filter((line) =>
          line.startsWith("Couldn't confirm"),
        ),
      ).toEqual([]);
    },
  );

  it.each([401, 403])(
    "unlocks a connect-mode copy with a note when the grant probe gets HTTP %i",
    async (status) => {
      const { dataDir } = await writeConnectLockWithGrant();
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response("bb connect: machine not authorized\n", { status }),
      );

      await runCommand(
        ["server", "unlock", "--data-dir", dataDir, "--yes"],
        register,
      );

      expect(await readServerMovedFile(dataDir)).toBeNull();
      expect(collectLogPayloads(vi.mocked(console.error))[0]).toBe(
        `Couldn't confirm whether the server at https://me.getbb.app is running (HTTP ${String(status)}). Make sure it is stopped before this old copy starts.`,
      );
    },
  );

  it("probes /health without headers for a direct-mode copy even when config.json has headers", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(
      dataDir,
      movedLock({
        mode: "direct",
        serverUrl: "https://desk.ts.net/",
        connectHandle: null,
      }),
    );
    await writeDataFile(
      dataDir,
      "config.json",
      JSON.stringify(connectGrantConfig),
    );
    vi.mocked(globalThis.fetch).mockResolvedValue(
      healthResponse(200, { ok: true }),
    );

    await expect(
      runCommand(
        ["server", "unlock", "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      "https://desk.ts.net/health",
      { signal: expect.any(AbortSignal) },
    );
  });

  it("warns, confirms, and removes the lock", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeDataFile(dataDir, "bb.db", "old server");
    await writeServerMovedFile(dataDir, movedLock());
    readlineMocks.question.mockResolvedValue("yes");

    await runCommand(["server", "unlock", "--data-dir", dataDir], register);

    expect(await readServerMovedFile(dataDir)).toBeNull();
    expect(await readFile(join(dataDir, "bb.db"), "utf8")).toBe("old server");
    const warnings = collectLogPayloads(vi.mocked(console.error));
    expect(warnings[0]).toMatch(
      /^This bb server moved to desktop \(https:\/\/me\.getbb\.app\) on /u,
    );
    expect(warnings.slice(1)).toEqual([
      "Unlocking starts this old copy again. Everything since the move is lost here: threads, settings, and plugin data changed on desktop stay there.",
      "Stop the bb server on desktop first. Two servers holding the same bb connect credential take each other's tunnel.",
    ]);
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      `Unlocked ${dataDir}. bb on this computer starts the old server again within a few seconds; if bb isn't running, start it with npx bb-app --data-dir ${dataDir}.`,
    ]);
  });

  it("keeps the lock when the confirmation is declined", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(dataDir, movedLock());
    readlineMocks.question.mockResolvedValue("n");

    await runCommand(["server", "unlock", "--data-dir", dataDir], register);

    expect(await readServerMovedFile(dataDir)).not.toBeNull();
  });

  it("refuses without --yes outside an interactive terminal", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(dataDir, movedLock());
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });

    await expect(
      runCommand(["server", "unlock", "--data-dir", dataDir], register),
    ).rejects.toThrow("process.exit:1");

    expect(await readServerMovedFile(dataDir)).not.toBeNull();
  });

  it("refuses to unlock an old copy that was already deleted", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(dataDir, movedLock({ oldCopyEntries: [] }));

    await expect(
      runCommand(
        ["server", "unlock", "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      `Error: The old server copy in ${dataDir} was deleted, so there is nothing to unlock. Unlocking would start an empty bb server.`,
    ]);
    expect(await readServerMovedFile(dataDir)).not.toBeNull();
  });

  it("reports an unlocked data directory without failing", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");

    await runCommand(
      ["server", "unlock", "--data-dir", dataDir, "--json"],
      register,
    );

    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!)).toEqual({
      dataDir,
      unlocked: false,
      removedConfigKeys: [],
    });
  });

  it("drops the new server's address and credentials from config.json and keeps everything else", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(dataDir, movedLock());
    const configPath = await writeDataFile(
      dataDir,
      "config.json",
      JSON.stringify({
        config: { BB_LOG_LEVEL: "debug", BB_APP_URL: "https://laptop.ts.net" },
        customModels: [{ providerId: "codex", model: "gpt-5.4" }],
        customAcpAgents: [{ id: "not a valid agent" }],
        serverUrl: "https://me.getbb.app",
        serverHeaders: { "x-bb-connect-machine": "credential" },
        machineCredential: "machine-secret",
        connectMachineId: "machine-1",
      }),
    );
    await chmod(configPath, 0o644);

    await runCommand(
      ["server", "unlock", "--data-dir", dataDir, "--yes", "--json"],
      register,
    );

    expect(await readServerMovedFile(dataDir)).toBeNull();
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      config: { BB_LOG_LEVEL: "debug", BB_APP_URL: "https://laptop.ts.net" },
      customModels: [{ providerId: "codex", model: "gpt-5.4" }],
      customAcpAgents: [{ id: "not a valid agent" }],
    });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(await readdir(dataDir)).toEqual(["config.json"]);
    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!)).toEqual({
      dataDir,
      unlocked: true,
      removedConfigKeys: [
        "serverUrl",
        "serverHeaders",
        "machineCredential",
        "connectMachineId",
      ],
    });
  });

  it("keeps the lock and config untouched when config.json is not a valid bb-app config", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(dataDir, movedLock());
    const invalid = JSON.stringify({
      serverUrl: "https://me.getbb.app",
      unexpected: true,
    });
    const configPath = await writeDataFile(dataDir, "config.json", invalid);

    await expect(
      runCommand(
        ["server", "unlock", "--data-dir", dataDir, "--yes"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error)).at(-1)).toMatch(
      new RegExp(
        `^Error: ${configPath.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")} is not a valid bb-app config\\. Fix it, then unlock again\\.`,
        "u",
      ),
    );
    expect(await readServerMovedFile(dataDir)).not.toBeNull();
    expect(await readFile(configPath, "utf8")).toBe(invalid);
  });

  it("unlocks without creating config.json when there is none", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(dataDir, movedLock());

    await runCommand(
      ["server", "unlock", "--data-dir", dataDir, "--yes"],
      register,
    );

    expect(await readdir(dataDir)).toEqual([]);
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      `Unlocked ${dataDir}. bb on this computer starts the old server again within a few seconds; if bb isn't running, start it with npx bb-app --data-dir ${dataDir}.`,
    ]);
  });

  it("uses BB_DATA_DIR when --data-dir is omitted", async () => {
    const dataDir = await makeTempDir("bb-cli-server-lock-");
    await writeServerMovedFile(dataDir, movedLock());
    vi.stubEnv("BB_DATA_DIR", dataDir);

    await runCommand(["server", "unlock", "--yes"], register);

    expect(await readServerMovedFile(dataDir)).toBeNull();
  });
});

describe("bb server delete-old-copy", () => {
  setupCommandOutputTestEnvironment();

  it("deletes the listed server entries and sidecars but keeps the lock and host-owned files", async () => {
    const dataDir = await makeTempDir("bb-cli-server-old-copy-");
    for (const path of [
      "bb.db",
      "bb.db-wal",
      "bb.db-shm",
      "attachments/thr_1/image.png",
      "plugins/tasks/data.db",
      "plugins/tasks/data.db-wal",
      "plugins/tasks/host-data/cache.json",
      "host-id",
      "auth.json",
      "config.json",
      "env.json",
      "thread-storage/thr_1/notes.md",
    ]) {
      await writeDataFile(dataDir, path, path);
    }
    await writeServerMovedFile(
      dataDir,
      movedLock({
        oldCopyEntries: [
          "bb.db",
          "attachments",
          "plugins/tasks/data.db",
          "config.json",
          "env.json",
        ],
      }),
    );
    readlineMocks.question.mockResolvedValue("y");

    await runCommand(
      ["server", "delete-old-copy", "--data-dir", dataDir],
      register,
    );

    expect(readlineMocks.question).toHaveBeenCalledWith(
      `Delete the old bb server copy in ${dataDir} (5 entries)? The server now runs on desktop; this cannot be undone. [y/N] `,
    );
    expect((await readdir(dataDir)).sort()).toEqual([
      "auth.json",
      "config.json",
      "env.json",
      "host-id",
      "plugins",
      SERVER_MOVED_FILE_NAME,
      "thread-storage",
    ]);
    expect(await readdir(join(dataDir, "plugins", "tasks"))).toEqual([
      "host-data",
    ]);
    expect(await readServerMovedFile(dataDir)).toEqual(
      movedLock({ oldCopyEntries: [] }),
    );
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      `Deleted the old bb server copy from ${dataDir} (3 entries). This computer keeps running as a regular machine.`,
    ]);
  });

  it("reports that there is no old copy when the data directory is not locked", async () => {
    const dataDir = await makeTempDir("bb-cli-server-old-copy-");
    await writeDataFile(dataDir, "bb.db", "this machine's server");

    await runCommand(
      ["server", "delete-old-copy", "--data-dir", dataDir, "--yes"],
      register,
    );

    expect(await readFile(join(dataDir, "bb.db"), "utf8")).toBe(
      "this machine's server",
    );
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      `No old server copy here: ${dataDir} is not locked by a server move.`,
    ]);
  });

  it("is a no-op after the old copy was deleted", async () => {
    const dataDir = await makeTempDir("bb-cli-server-old-copy-");
    await writeServerMovedFile(dataDir, movedLock({ oldCopyEntries: [] }));

    await runCommand(
      ["server", "delete-old-copy", "--data-dir", dataDir, "--json"],
      register,
    );

    expect(readlineMocks.question).not.toHaveBeenCalled();
    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!)).toEqual({
      dataDir,
      deleted: false,
      deletedEntries: [],
    });
    expect(await readdir(dataDir)).toEqual([SERVER_MOVED_FILE_NAME]);
  });

  it("keeps everything when the confirmation is declined", async () => {
    const dataDir = await makeTempDir("bb-cli-server-old-copy-");
    await writeDataFile(dataDir, "bb.db", "old server");
    await writeServerMovedFile(dataDir, movedLock());
    readlineMocks.question.mockResolvedValue("n");

    await runCommand(
      ["server", "delete-old-copy", "--data-dir", dataDir],
      register,
    );

    expect(await readFile(join(dataDir, "bb.db"), "utf8")).toBe("old server");
    expect((await readServerMovedFile(dataDir))?.oldCopyEntries).toEqual(
      movedLock().oldCopyEntries,
    );
    expect(await readdir(dataDir)).not.toContain(SERVER_IMPORT_FILE_NAME);
  });
});
