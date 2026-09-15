import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Header } from "tar/header";
import type { EntryTypeName } from "tar/types";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  detectServerArchiveEncryption,
  extractServerArchive,
  type ServerArchiveEncryption,
  ServerArchiveError,
  type ServerArchiveErrorCode,
  type ServerArchiveManifestInput,
  type ServerArchiveSourceFile,
  writeServerArchive,
} from "../src/index.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bb-server-archive-"));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((tempDir) => rm(tempDir, { force: true, recursive: true })),
  );
});

const MANIFEST_INPUT: ServerArchiveManifestInput = {
  createdAt: Date.UTC(2026, 8, 15, 12, 0, 0),
  bbVersion: "0.43.1",
  protocolVersion: 209,
  migrationCount: 142,
  sourceDataDir: "/home/old/.bb",
  sourceServerHostId: "host-old",
};

const PLAINTEXT_MARKER = "plaintext-marker-3f9a1c";

interface SourceTree {
  root: string;
  files: ServerArchiveSourceFile[];
  contents: Map<string, Buffer>;
}

async function createSourceTree(): Promise<SourceTree> {
  const root = await makeTempDir();
  const longSegment = "a-very-long-directory-name-that-forces-pax-headers";
  const sources: Array<{ archivePath: string; body: Buffer; mode: number }> = [
    { archivePath: "bb.db", body: randomBytes(300 * 1024), mode: 0o644 },
    {
      archivePath: "config.json",
      body: Buffer.from(
        JSON.stringify({ config: { BB_LOG_LEVEL: PLAINTEXT_MARKER } }),
      ),
      mode: 0o600,
    },
    { archivePath: "telemetry-id", body: Buffer.alloc(0), mode: 0o644 },
    {
      archivePath: `plugins/npm/${longSegment}/${longSegment}/${longSegment}/bin/tool`,
      body: Buffer.from("#!/bin/sh\necho hi\n"),
      mode: 0o755,
    },
    {
      archivePath: "attachments/café/übersicht.txt",
      body: Buffer.from("unicode"),
      mode: 0o644,
    },
  ];
  const files: ServerArchiveSourceFile[] = [];
  const contents = new Map<string, Buffer>();
  for (const [index, source] of sources.entries()) {
    const sourcePath = path.join(root, "source", `${String(index)}.bin`);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, source.body);
    await chmod(sourcePath, source.mode);
    files.push({ sourcePath, archivePath: source.archivePath });
    contents.set(source.archivePath, source.body);
  }
  return { root, files, contents };
}

async function expectArchiveError(
  promise: Promise<unknown>,
  codes: readonly ServerArchiveErrorCode[],
): Promise<ServerArchiveError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ServerArchiveError);
  if (!(error instanceof ServerArchiveError)) {
    throw new Error("expected a ServerArchiveError");
  }
  expect(codes).toContain(error.code);
  return error;
}

async function listFilesRecursively(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) =>
      path
        .relative(root, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/"),
    )
    .sort();
}

async function expectExtractedTree(
  destinationDir: string,
  tree: SourceTree,
): Promise<void> {
  const filesDir = path.join(destinationDir, "files");
  expect(await listFilesRecursively(filesDir)).toEqual(
    [...tree.contents.keys()].sort(),
  );
  for (const [archivePath, body] of tree.contents) {
    expect(
      await readFile(path.join(filesDir, ...archivePath.split("/"))),
    ).toEqual(body);
  }
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

interface CraftedEntry {
  path: string;
  body?: Buffer;
  type?: EntryTypeName;
  linkpath?: string;
  size?: number;
}

function craftArchive(entries: CraftedEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const body = entry.body ?? Buffer.alloc(0);
    const header = new Header({
      path: entry.path,
      mode: 0o644,
      uid: 0,
      gid: 0,
      size: entry.size ?? body.length,
      mtime: new Date(0),
      type: entry.type ?? "File",
      linkpath: entry.linkpath,
    });
    header.encode();
    if (header.block === undefined) {
      throw new Error("failed to encode crafted header");
    }
    chunks.push(
      header.block,
      body,
      Buffer.alloc((512 - (body.length % 512)) % 512),
    );
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

function craftedManifest(files: Array<{ path: string; body: Buffer }>): Buffer {
  return Buffer.from(
    JSON.stringify({
      format: "bb-server-archive",
      version: 1,
      ...MANIFEST_INPUT,
      entries: files.map((file) => ({
        path: file.path,
        size: file.body.length,
        sha256: sha256(file.body),
      })),
    }),
  );
}

async function extractCrafted(entries: CraftedEntry[]): Promise<{
  result: Promise<unknown>;
  destinationDir: string;
  root: string;
}> {
  const root = await makeTempDir();
  const archivePath = path.join(root, "crafted.tar.gz");
  await writeFile(archivePath, craftArchive(entries));
  const destinationDir = path.join(root, "nested", "staging");
  return {
    result: extractServerArchive({
      archivePath,
      encryption: null,
      destinationDir,
    }),
    destinationDir,
    root,
  };
}

describe("writeServerArchive and extractServerArchive", () => {
  it("round trips a plain archive with long, unicode, empty, and executable files", async () => {
    const tree = await createSourceTree();
    const outPath = path.join(tree.root, "out", "server.tar.gz");

    const written = await writeServerArchive({
      outPath,
      files: tree.files,
      manifest: MANIFEST_INPUT,
      encryption: null,
    });

    const archiveBytes = await readFile(outPath);
    expect(written.sizeBytes).toBe(archiveBytes.length);
    expect(written.sha256).toBe(sha256(archiveBytes));
    expect((await stat(outPath)).mode & 0o777).toBe(0o600);
    expect(await readdir(path.dirname(outPath))).toEqual(["server.tar.gz"]);
    expect(written.manifest.entries).toEqual(
      tree.files.map((file) => {
        const body = tree.contents.get(file.archivePath) ?? Buffer.alloc(0);
        return {
          path: file.archivePath,
          size: body.length,
          sha256: sha256(body),
        };
      }),
    );
    expect(await detectServerArchiveEncryption(outPath)).toBe("none");

    const destinationDir = path.join(tree.root, "staging");
    const manifest = await extractServerArchive({
      archivePath: outPath,
      encryption: null,
      destinationDir,
    });

    expect(manifest).toEqual(written.manifest);
    await expectExtractedTree(destinationDir, tree);
    const toolPath = path.join(
      destinationDir,
      "files",
      ...(tree.files[3]?.archivePath ?? "").split("/"),
    );
    expect((await stat(toolPath)).mode & 0o100).toBe(0o100);
  });

  it("round trips an archive encrypted with a raw key and rejects a different key", async () => {
    const tree = await createSourceTree();
    const outPath = path.join(tree.root, "server.bbsa");
    const key = randomBytes(32);

    await writeServerArchive({
      outPath,
      files: tree.files,
      manifest: MANIFEST_INPUT,
      encryption: { kind: "key", key },
    });

    expect(await detectServerArchiveEncryption(outPath)).toBe("key");
    expect((await readFile(outPath)).subarray(0, 5)).toEqual(
      Buffer.from([0x42, 0x42, 0x53, 0x41, 0x01]),
    );

    const wrongKeyDir = path.join(tree.root, "wrong-key");
    await expectArchiveError(
      extractServerArchive({
        archivePath: outPath,
        encryption: { kind: "key", key: randomBytes(32) },
        destinationDir: wrongKeyDir,
      }),
      ["bad_passphrase"],
    );

    const destinationDir = path.join(tree.root, "staging");
    await extractServerArchive({
      archivePath: outPath,
      encryption: { kind: "key", key },
      destinationDir,
    });
    await expectExtractedTree(destinationDir, tree);
  });

  it("refuses symbolic link sources and unsafe or conflicting archive paths", async () => {
    const tree = await createSourceTree();
    const linkPath = path.join(tree.root, "link");
    await symlink(tree.files[0]?.sourcePath ?? "", linkPath);
    const write = (files: ServerArchiveSourceFile[]) =>
      writeServerArchive({
        outPath: path.join(tree.root, "out.tar.gz"),
        files,
        manifest: MANIFEST_INPUT,
        encryption: null,
      });
    const sourcePath = tree.files[0]?.sourcePath ?? "";

    await expectArchiveError(
      write([{ sourcePath: linkPath, archivePath: "bb.db" }]),
      ["unsafe_entry"],
    );
    for (const archivePath of [
      "../escape",
      "/absolute",
      "attachments/./b",
      "attachments//b",
      "attachments\\b",
      "auth.json",
      "systemd/bb-host-daemon.service",
      "plugins/docs/host-data/vault.md",
    ]) {
      await expectArchiveError(write([{ sourcePath, archivePath }]), [
        "unsafe_entry",
      ]);
    }
    await expectArchiveError(
      write([
        { sourcePath, archivePath: "attachments/thr_1" },
        { sourcePath, archivePath: "attachments/thr_1/image.png" },
      ]),
      ["unsafe_entry"],
    );
    expect(await readdir(tree.root)).not.toContain("out.tar.gz");
  });

  it("refuses to extract into a non-empty destination", async () => {
    const tree = await createSourceTree();
    const outPath = path.join(tree.root, "server.tar.gz");
    await writeServerArchive({
      outPath,
      files: tree.files,
      manifest: MANIFEST_INPUT,
      encryption: null,
    });
    const destinationDir = path.join(tree.root, "staging");
    await mkdir(destinationDir);
    await writeFile(path.join(destinationDir, "existing"), "keep");

    await expect(
      extractServerArchive({
        archivePath: outPath,
        encryption: null,
        destinationDir,
      }),
    ).rejects.toThrow(/not empty/u);
    expect(await readdir(destinationDir)).toEqual(["existing"]);
  });

  it("reports corrupt data for truncated archives and non-archives", async () => {
    const tree = await createSourceTree();
    const outPath = path.join(tree.root, "server.tar.gz");
    await writeServerArchive({
      outPath,
      files: tree.files,
      manifest: MANIFEST_INPUT,
      encryption: null,
    });
    const bytes = await readFile(outPath);
    const truncatedPath = path.join(tree.root, "truncated.tar.gz");
    await writeFile(
      truncatedPath,
      bytes.subarray(0, Math.floor(bytes.length / 2)),
    );
    const destinationDir = path.join(tree.root, "staging");

    await expectArchiveError(
      extractServerArchive({
        archivePath: truncatedPath,
        encryption: null,
        destinationDir,
      }),
      ["corrupt"],
    );
    expect(await readdir(destinationDir)).toEqual([]);

    const junkPath = path.join(tree.root, "junk.bin");
    await writeFile(junkPath, "not an archive at all");
    await expectArchiveError(detectServerArchiveEncryption(junkPath), [
      "corrupt",
    ]);
  });
});

describe("passphrase-encrypted archives", () => {
  const passphrase = "correct horse battery staple";
  let tree: SourceTree;
  let archiveBytes: Buffer;

  beforeAll(async () => {
    tree = await createSourceTree();
    const outPath = path.join(tree.root, "server.bbsa");
    await writeServerArchive({
      outPath,
      files: tree.files,
      manifest: MANIFEST_INPUT,
      encryption: { kind: "passphrase", passphrase },
    });
    archiveBytes = await readFile(outPath);
    tempDirs.splice(tempDirs.indexOf(tree.root), 1);
    return () => rm(tree.root, { force: true, recursive: true });
  });

  async function writeVariant(
    bytes: Buffer,
  ): Promise<{ archivePath: string; root: string }> {
    const root = await makeTempDir();
    const archivePath = path.join(root, "variant.bbsa");
    await writeFile(archivePath, bytes);
    return { archivePath, root };
  }

  async function extractVariant(
    bytes: Buffer,
    encryption: ServerArchiveEncryption | null,
  ): Promise<{ result: Promise<unknown>; destinationDir: string }> {
    const { archivePath, root } = await writeVariant(bytes);
    const destinationDir = path.join(root, "staging");
    return {
      result: extractServerArchive({ archivePath, encryption, destinationDir }),
      destinationDir,
    };
  }

  it("round trips with the passphrase and never stores plaintext", async () => {
    expect(archiveBytes.includes(Buffer.from(PLAINTEXT_MARKER))).toBe(false);
    const { archivePath, root } = await writeVariant(archiveBytes);
    expect(await detectServerArchiveEncryption(archivePath)).toBe("passphrase");

    const destinationDir = path.join(root, "staging");
    await extractServerArchive({
      archivePath,
      encryption: { kind: "passphrase", passphrase },
      destinationDir,
    });
    await expectExtractedTree(destinationDir, tree);
  });

  it("rejects a wrong passphrase before writing anything", async () => {
    const { result, destinationDir } = await extractVariant(archiveBytes, {
      kind: "passphrase",
      passphrase: "wrong horse battery staple",
    });
    await expectArchiveError(result, ["bad_passphrase"]);
    await expect(readdir(destinationDir)).rejects.toThrow(/ENOENT/u);
  });

  it("rejects a missing passphrase or a key for a passphrase archive", async () => {
    const missing = await extractVariant(archiveBytes, null);
    await expectArchiveError(missing.result, ["encryption_mismatch"]);
    const withKey = await extractVariant(archiveBytes, {
      kind: "key",
      key: randomBytes(32),
    });
    await expectArchiveError(withKey.result, ["encryption_mismatch"]);
  });

  it("rejects a tampered authentication tag and removes the partial extraction", async () => {
    const tampered = Buffer.from(archiveBytes);
    const lastIndex = tampered.length - 1;
    tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 0xff;

    const { result, destinationDir } = await extractVariant(tampered, {
      kind: "passphrase",
      passphrase,
    });

    const error = await expectArchiveError(result, ["corrupt"]);
    expect(error.message).toMatch(/authentication/u);
    expect(await readdir(destinationDir)).toEqual([]);
  });

  it("rejects tampered ciphertext", async () => {
    const tampered = Buffer.from(archiveBytes);
    const middle = Math.floor(tampered.length / 2);
    tampered[middle] = (tampered[middle] ?? 0) ^ 0x01;

    const { result, destinationDir } = await extractVariant(tampered, {
      kind: "passphrase",
      passphrase,
    });

    await expectArchiveError(result, ["corrupt", "digest_mismatch"]);
    expect(await readdir(destinationDir)).toEqual([]);
  });

  it("rejects a modified header that still parses", async () => {
    const headerLength = archiveBytes.readUInt32BE(5);
    const spacedHeader = Buffer.concat([
      Buffer.from(" "),
      archiveBytes.subarray(9, 9 + headerLength),
    ]);
    const fixedPrefix = Buffer.from(archiveBytes.subarray(0, 9));
    fixedPrefix.writeUInt32BE(spacedHeader.length, 5);
    const tampered = Buffer.concat([
      fixedPrefix,
      spacedHeader,
      archiveBytes.subarray(9 + headerLength),
    ]);

    const { result } = await extractVariant(tampered, {
      kind: "passphrase",
      passphrase,
    });

    const error = await expectArchiveError(result, ["corrupt"]);
    expect(error.message).toMatch(/authentication/u);
  });

  it("rejects an unsupported encrypted format version", async () => {
    const future = Buffer.from(archiveBytes);
    future[4] = 2;
    const { archivePath } = await writeVariant(future);
    await expectArchiveError(detectServerArchiveEncryption(archivePath), [
      "unsupported_version",
    ]);
  });
});

describe("extracting crafted archives", () => {
  const body = Buffer.from("server data");

  it("rejects a file whose content does not match the manifest digest", async () => {
    const { result, destinationDir } = await extractCrafted([
      {
        path: "manifest.json",
        body: craftedManifest([{ path: "bb.db", body }]),
      },
      { path: "files/bb.db", body: Buffer.from("SERVER DATA") },
    ]);
    await expectArchiveError(result, ["digest_mismatch"]);
    expect(await readdir(destinationDir)).toEqual([]);
  });

  it("rejects an entry larger than the manifest size before writing its body", async () => {
    const { result, destinationDir } = await extractCrafted([
      {
        path: "manifest.json",
        body: craftedManifest([{ path: "bb.db", body }]),
      },
      { path: "files/bb.db", body: Buffer.alloc(4 * 1024 * 1024) },
    ]);
    const error = await expectArchiveError(result, ["digest_mismatch"]);
    expect(error.message).toMatch(/manifest lists 11/u);
    expect(await readdir(destinationDir)).toEqual([]);
  });

  it.each([
    ["a parent-directory path", "files/../../escape"],
    ["an absolute path", "/tmp/bb-server-archive-escape"],
    ["a path outside files/", "escape"],
  ])(
    "rejects %s without writing outside the destination",
    async (_label, entryPath) => {
      const { result, root } = await extractCrafted([
        {
          path: "manifest.json",
          body: craftedManifest([{ path: "escape", body }]),
        },
        { path: entryPath, body },
      ]);
      await expectArchiveError(result, ["unsafe_entry"]);
      expect(await readdir(root)).toEqual(["crafted.tar.gz", "nested"]);
      expect(await readdir(path.join(root, "nested"))).toEqual(["staging"]);
    },
  );

  it.each([
    [
      "a symbolic link",
      { type: "SymbolicLink" as const, linkpath: "/etc/passwd" },
    ],
    ["a hard link", { type: "Link" as const, linkpath: "files/other" }],
    ["a character device", { type: "CharacterDevice" as const }],
    ["a directory", { type: "Directory" as const }],
  ])("rejects %s entry", async (_label, entry) => {
    const { result, destinationDir } = await extractCrafted([
      {
        path: "manifest.json",
        body: craftedManifest([{ path: "link", body }]),
      },
      { path: "files/link", ...entry },
    ]);
    await expectArchiveError(result, ["unsafe_entry"]);
    expect(await readdir(destinationDir)).toEqual([]);
  });

  it("rejects entries missing from the manifest and manifest entries missing from the archive", async () => {
    const extra = await extractCrafted([
      {
        path: "manifest.json",
        body: craftedManifest([{ path: "bb.db", body }]),
      },
      { path: "files/bb.db", body },
      { path: "files/extra", body },
    ]);
    await expectArchiveError(extra.result, ["unsafe_entry"]);

    const duplicate = await extractCrafted([
      {
        path: "manifest.json",
        body: craftedManifest([{ path: "bb.db", body }]),
      },
      { path: "files/bb.db", body },
      { path: "files/bb.db", body },
    ]);
    await expectArchiveError(duplicate.result, ["unsafe_entry"]);

    const missing = await extractCrafted([
      {
        path: "manifest.json",
        body: craftedManifest([
          { path: "bb.db", body },
          { path: "env.json", body },
        ]),
      },
      { path: "files/bb.db", body },
    ]);
    await expectArchiveError(missing.result, ["corrupt"]);
  });

  it("rejects archives whose first entry is not a valid manifest", async () => {
    const misplacedManifest = await extractCrafted([
      { path: "files/manifest.json", body: craftedManifest([]) },
    ]);
    await expectArchiveError(misplacedManifest.result, ["corrupt"]);

    const notFirst = await extractCrafted([
      { path: "files/bb.db", body },
      {
        path: "manifest.json",
        body: craftedManifest([{ path: "bb.db", body }]),
      },
    ]);
    await expectArchiveError(notFirst.result, ["corrupt"]);

    const traversingManifest = await extractCrafted([
      {
        path: "manifest.json",
        body: craftedManifest([{ path: "../bb.db", body }]),
      },
    ]);
    await expectArchiveError(traversingManifest.result, ["corrupt"]);

    const futureManifest = await extractCrafted([
      {
        path: "manifest.json",
        body: Buffer.from(
          JSON.stringify({ format: "bb-server-archive", version: 2 }),
        ),
      },
    ]);
    await expectArchiveError(futureManifest.result, ["unsupported_version"]);
  });
});
