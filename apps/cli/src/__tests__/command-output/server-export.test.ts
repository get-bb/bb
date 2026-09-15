import { createHash } from "node:crypto";
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

function sha256Of(chunks: readonly Uint8Array[]): string {
  const hash = createHash("sha256");
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest("hex");
}

function exportResponse(
  body: ReadableStream<Uint8Array>,
  sha256: string | null,
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-disposition":
        'attachment; filename="bb-server-2026-09-15.tar.gz"',
      "content-type": "application/gzip",
      ...(sha256 === null ? {} : { "x-bb-archive-sha256": sha256 }),
    },
  });
}

const UNENCRYPTED_EXPORT_WARNING =
  "This export is not encrypted and holds the server's credentials and plugin secrets. Keep it private; bb wrote it with mode 0600.";

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

  it("streams the archive to a private file after checking the server's digest", async () => {
    const dir = await makeTempDir();
    const outPath = join(dir, "backup.tar.gz");
    const chunks = [
      Buffer.from([0x1f, 0x8b]),
      Buffer.alloc(1024 * 1024 + 512, 7),
      Buffer.from("tail"),
    ];
    const exportRoute = vi.fn(async () =>
      exportResponse(streamOf(chunks), sha256Of(chunks)),
    );
    stubServerApi({ "v1.server.export.$post": exportRoute });

    await runCommand(["server", "export", "--out", outPath], register);

    expect(exportRoute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ init: expect.anything() }),
    );
    const written = await readFile(outPath);
    expect(written.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(written.length).toBe(2 + 1024 * 1024 + 512 + 4);
    expect((await stat(outPath)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(["backup.tar.gz"]);
  });

  it("warns that the export is unencrypted and holds the server's credentials", async () => {
    const dir = await makeTempDir();
    const outPath = join(dir, "backup.tar.gz");
    const chunks = [Buffer.from([0x1f, 0x8b]), Buffer.alloc(1024 * 1024, 3)];
    const sha256 = sha256Of(chunks);
    stubServerApi({
      "v1.server.export.$post": vi.fn(async () =>
        exportResponse(streamOf(chunks), sha256),
      ),
    });

    await runCommand(["server", "export", "--out", outPath], register);

    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      `Exported the bb server to ${outPath} (1.0 MB)`,
    ]);
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      UNENCRYPTED_EXPORT_WARNING,
    ]);

    vi.mocked(console.log).mockClear();
    vi.mocked(console.error).mockClear();
    await runCommand(
      ["server", "export", "--out", outPath, "--json"],
      register,
    );

    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!)).toEqual({
      path: outPath,
      sizeBytes: 2 + 1024 * 1024,
      sha256,
      warning: UNENCRYPTED_EXPORT_WARNING,
    });
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([]);
  });

  it("refuses to keep an export whose bytes do not match the server's digest", async () => {
    const dir = await makeTempDir();
    const outPath = join(dir, "backup.tar.gz");
    stubServerApi({
      "v1.server.export.$post": vi.fn(async () =>
        exportResponse(
          streamOf([Buffer.from("truncated export")]),
          sha256Of([Buffer.from("the export the server wrote")]),
        ),
      ),
    });

    await expect(
      runCommand(["server", "export", "--out", outPath], register),
    ).rejects.toThrow("process.exit:1");

    expect(await readdir(dir)).toEqual([]);
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      `Error: The downloaded export does not match the SHA-256 digest the server sent, so ${outPath} was not written. Try the export again.`,
    ]);
  });

  it("refuses an export response without a digest before writing anything", async () => {
    const dir = await makeTempDir();
    const outPath = join(dir, "backup.tar.gz");
    stubServerApi({
      "v1.server.export.$post": vi.fn(async () =>
        exportResponse(streamOf([Buffer.from([0x1f, 0x8b])]), null),
      ),
    });

    await expect(
      runCommand(["server", "export", "--out", outPath], register),
    ).rejects.toThrow("process.exit:1");

    expect(await readdir(dir)).toEqual([]);
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      "Error: The server did not send a SHA-256 digest for the export",
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

    await expect(
      runCommand(
        ["server", "export", "--out", join(dir, "backup.tar.gz")],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      'Error: Moving the server is off. Turn on the "Server move" experiment in Settings → Experiments, or run bb settings experiment serverMove true, then try again.',
    ]);
    expect(await readdir(dir)).toEqual([]);
  });

  it("removes the partial file and keeps an existing archive when the download breaks", async () => {
    const dir = await makeTempDir();
    const outPath = join(dir, "backup.tar.gz");
    const previous = [Buffer.from("previous backup")];
    stubServerApi({
      "v1.server.export.$post": vi.fn(async () =>
        exportResponse(streamOf(previous), sha256Of(previous)),
      ),
    });
    await runCommand(["server", "export", "--out", outPath], register);
    stubServerApi({
      "v1.server.export.$post": vi.fn(async () =>
        exportResponse(
          streamOf([Buffer.from("partial")], new Error("connection reset")),
          sha256Of([Buffer.from("partial and the rest")]),
        ),
      ),
    });

    await expect(
      runCommand(["server", "export", "--out", outPath], register),
    ).rejects.toThrow("process.exit:1");

    expect(await readdir(dir)).toEqual(["backup.tar.gz"]);
    expect(await readFile(outPath, "utf8")).toBe("previous backup");
    expect(collectLogPayloads(vi.mocked(console.error)).at(-1)).toBe(
      "Error: connection reset",
    );
  });

  it("checks the output directory before asking the server to export", async () => {
    const dir = await makeTempDir();
    const exportRoute = vi.fn();
    stubServerApi({ "v1.server.export.$post": exportRoute });

    await expect(
      runCommand(
        ["server", "export", "--out", join(dir, "missing", "backup.tar.gz")],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(exportRoute).not.toHaveBeenCalled();
    expect(collectLogPayloads(vi.mocked(console.error))).toEqual([
      `Error: Directory ${join(dir, "missing")} does not exist.`,
    ]);
  });
});
