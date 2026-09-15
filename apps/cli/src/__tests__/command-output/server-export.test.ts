import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerServerCommands } from "../../commands/server.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-cli-server-export-"));
  tempDirs.push(dir);
  return dir;
}

function streamOf(chunks: readonly Uint8Array[], failure?: Error) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk !== undefined) {
        controller.enqueue(chunk);
        return;
      }
      if (failure !== undefined) {
        controller.error(failure);
        return;
      }
      controller.close();
    },
  });
}

function exportResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-disposition": 'attachment; filename="bb-server-2026-09-15.bbsa"',
      "content-type": "application/octet-stream",
    },
  });
}

describe("bb server export", () => {
  setupCommandOutputTestEnvironment();

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { force: true, recursive: true })),
    );
  });

  const register: CommandRegistrar = (program) =>
    registerServerCommands(
      program.enablePositionalOptions(),
      () => "http://server",
    );

  it("streams the archive to a private file using the passphrase from the environment", async () => {
    const dir = await makeTempDir();
    const outPath = join(dir, "backup.bbsa");
    const exportRoute = vi.fn(async () =>
      exportResponse(
        streamOf([
          Buffer.from("BBSA"),
          Buffer.alloc(1024 * 1024 + 512, 7),
          Buffer.from("tail"),
        ]),
      ),
    );
    stubServerApi({ "v1.server.export.$post": exportRoute });
    vi.stubEnv("BB_SERVER_EXPORT_PASSPHRASE", "correct horse battery staple");

    await runCommand(["server", "export", "--out", outPath], register);

    expect(exportRoute).toHaveBeenCalledWith(
      { json: { passphrase: "correct horse battery staple" } },
      expect.objectContaining({ init: expect.anything() }),
    );
    const written = await readFile(outPath);
    expect(written.subarray(0, 4).toString()).toBe("BBSA");
    expect(written.length).toBe(4 + 1024 * 1024 + 512 + 4);
    expect((await stat(outPath)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(["backup.bbsa"]);
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      `Exported the bb server to ${outPath} (1.0 MB)`,
    ]);
  });

  it("--unencrypted asks the server for a plain archive without a passphrase", async () => {
    const dir = await makeTempDir();
    const outPath = join(dir, "backup.tar.gz");
    const exportRoute = vi.fn(async () =>
      exportResponse(streamOf([Buffer.from([0x1f, 0x8b, 0, 0])])),
    );
    stubServerApi({ "v1.server.export.$post": exportRoute });
    vi.stubEnv("BB_SERVER_EXPORT_PASSPHRASE", undefined);
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    await runCommand(
      ["server", "export", "--out", outPath, "--unencrypted", "--json"],
      register,
    );

    expect(exportRoute).toHaveBeenCalledWith(
      { json: { passphrase: null } },
      expect.anything(),
    );
    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!)).toEqual({
      path: outPath,
      sizeBytes: 4,
      encrypted: false,
    });
  });

  it("refuses without a passphrase source instead of exporting unencrypted", async () => {
    const dir = await makeTempDir();
    const exportRoute = vi.fn();
    stubServerApi({ "v1.server.export.$post": exportRoute });
    vi.stubEnv("BB_SERVER_EXPORT_PASSPHRASE", undefined);
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    await expect(
      runCommand(
        ["server", "export", "--out", join(dir, "backup.bbsa")],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(exportRoute).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: Set BB_SERVER_EXPORT_PASSPHRASE or run this command in an interactive terminal to enter a passphrase. Pass --unencrypted to export without encryption.",
    ]);
  });

  it("prints the server's experiment message and exits nonzero while server move is off", async () => {
    const dir = await makeTempDir();
    stubServerApi({
      "v1.server.export.$post": vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: "server_move_experiment_disabled",
              message:
                'Moving the server is off. Turn on the "Server move" experiment in Settings → Experiments, or run bb settings experiment serverMove true, then try again.',
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          ),
      ),
    });
    vi.stubEnv("BB_SERVER_EXPORT_PASSPHRASE", "long enough secret");

    await expect(
      runCommand(
        ["server", "export", "--out", join(dir, "backup.bbsa")],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      'Error: Moving the server is off. Turn on the "Server move" experiment in Settings → Experiments, or run bb settings experiment serverMove true, then try again.',
    ]);
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses a passphrase variable shorter than 8 characters", async () => {
    const dir = await makeTempDir();
    const exportRoute = vi.fn();
    stubServerApi({ "v1.server.export.$post": exportRoute });
    vi.stubEnv("BB_SERVER_EXPORT_PASSPHRASE", "short");

    await expect(
      runCommand(
        ["server", "export", "--out", join(dir, "backup.bbsa")],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(exportRoute).not.toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: BB_SERVER_EXPORT_PASSPHRASE must be at least 8 characters.",
    ]);
  });

  it("rejects an empty passphrase variable", async () => {
    const dir = await makeTempDir();
    const exportRoute = vi.fn();
    stubServerApi({ "v1.server.export.$post": exportRoute });
    vi.stubEnv("BB_SERVER_EXPORT_PASSPHRASE", "");

    await expect(
      runCommand(
        ["server", "export", "--out", join(dir, "backup.bbsa")],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(exportRoute).not.toHaveBeenCalled();
  });

  it("removes the partial file and keeps an existing archive when the download breaks", async () => {
    const dir = await makeTempDir();
    const outPath = join(dir, "backup.bbsa");
    vi.stubEnv("BB_SERVER_EXPORT_PASSPHRASE", "long enough secret");
    stubServerApi({
      "v1.server.export.$post": vi.fn(async () =>
        exportResponse(streamOf([Buffer.from("previous backup")])),
      ),
    });
    await runCommand(["server", "export", "--out", outPath], register);
    stubServerApi({
      "v1.server.export.$post": vi.fn(async () =>
        exportResponse(
          streamOf([Buffer.from("partial")], new Error("connection reset")),
        ),
      ),
    });

    await expect(
      runCommand(["server", "export", "--out", outPath], register),
    ).rejects.toThrow("process.exit:1");

    expect(await readdir(dir)).toEqual(["backup.bbsa"]);
    expect(await readFile(outPath, "utf8")).toBe("previous backup");
    expect(collectLogPayloads(vi.mocked(console.error)).at(-1)).toBe(
      "Error: connection reset",
    );
  });

  it("checks the output directory before asking the server to export", async () => {
    const dir = await makeTempDir();
    const exportRoute = vi.fn();
    stubServerApi({ "v1.server.export.$post": exportRoute });
    vi.stubEnv("BB_SERVER_EXPORT_PASSPHRASE", "long enough secret");

    await expect(
      runCommand(
        ["server", "export", "--out", join(dir, "missing", "backup.bbsa")],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(exportRoute).not.toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      `Error: Directory ${join(dir, "missing")} does not exist.`,
    ]);
  });
});
