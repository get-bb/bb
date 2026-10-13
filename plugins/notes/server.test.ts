import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const NOTES_ROOT = "/tmp/notes-under-test";

interface FileStubs {
  read?: ReturnType<typeof vi.fn>;
  listPaths?: ReturnType<typeof vi.fn>;
  write?: ReturnType<typeof vi.fn>;
  mkdir?: ReturnType<typeof vi.fn>;
  move?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
}

async function setup(overrides: FileStubs = {}, rootDirectory = NOTES_ROOT) {
  const files = {
    read:
      overrides.read ??
      vi.fn(() => ({
        content: "# Today\n\n#PRIORITY ship it\n",
        contentEncoding: "utf8",
        sizeBytes: 32,
        sha256: "original",
      })),
    listPaths:
      overrides.listPaths ??
      vi.fn(() => ({
        paths: [
          { path: "work", kind: "directory" },
          { path: "work/plan.md", kind: "file" },
          { path: "image.png", kind: "file" },
        ],
        truncated: false,
      })),
    write: overrides.write ?? vi.fn(() => ({ outcome: "written", sha256: "new" })),
    mkdir: overrides.mkdir ?? vi.fn(() => ({ ok: true })),
    move: overrides.move ?? vi.fn(() => ({ ok: true })),
    remove: overrides.remove ?? vi.fn(() => ({ ok: true })),
    createPreview: vi.fn(() => ({
      baseUrl: "/preview/notes",
      expiresAtMs: Date.now() + 3_600_000,
    })),
  };
  const { bb, harness } = createFakePluginHost({
    pluginId: "notes",
    settings: { rootDirectory },
    sdk: {
      system: { config: () => ({ dataDir: "/server-data" }) },
      files,
    },
  });
  await plugin(bb);
  return { harness, files };
}

describe("reading notes", () => {
  it("resolves a relative path against the notes root", async () => {
    const { harness, files } = await setup();
    const result = await harness.callRpc("read", { path: "work/plan.md" });
    expect(files.read).toHaveBeenCalledWith({
      path: path.join(NOTES_ROOT, "work/plan.md"),
      rootPath: NOTES_ROOT,
    });
    expect(result).toMatchObject({ kind: "text", path: "work/plan.md" });
  });

  it("refuses to open a non-Markdown file without touching the disk", async () => {
    const { harness, files } = await setup();
    const result = await harness.callRpc("read", { path: "secrets.env" });
    expect(result).toMatchObject({ kind: "unsupported" });
    expect(files.read).not.toHaveBeenCalled();
  });

  it("refuses a path that escapes the notes root", async () => {
    const { harness, files } = await setup();
    await expect(
      harness.callRpc("read", { path: "../.ssh/id_rsa.md" }),
    ).rejects.toThrow(/outside the notes folder/);
    expect(files.read).not.toHaveBeenCalled();
  });

  it("rejects an absolute path at the schema boundary", async () => {
    const { harness } = await setup();
    await expect(
      harness.callRpc("read", { path: "/etc/passwd.md" }),
    ).rejects.toThrow();
  });

  it("reports a binary file as unsupported", async () => {
    const { harness } = await setup({
      read: vi.fn(() => ({
        content: "",
        contentEncoding: "base64",
        sizeBytes: 10,
        sha256: "x",
      })),
    });
    const result = await harness.callRpc("read", { path: "a.md" });
    expect(result).toMatchObject({ kind: "unsupported", reason: /not text/ });
  });

  it("reports an oversized note as unsupported rather than loading it", async () => {
    const { harness } = await setup({
      read: vi.fn(() => ({
        content: "x",
        contentEncoding: "utf8",
        sizeBytes: 9 * 1024 * 1024,
        sha256: "x",
      })),
    });
    const result = await harness.callRpc("read", { path: "big.md" });
    expect(result).toMatchObject({ kind: "unsupported", reason: /too large/ });
  });
});

describe("listing notes", () => {
  it("lists the root without hidden files", async () => {
    const { harness, files } = await setup();
    const result = await harness.callRpc("tree", null);
    expect(files.listPaths).toHaveBeenCalledWith({
      path: NOTES_ROOT,
      includeFiles: true,
      includeDirectories: true,
      includeHidden: false,
      limit: 10_000,
    });
    expect(result.root).toBe(NOTES_ROOT);
    // Filtering to Markdown happens in the panel, so the raw listing is
    // passed through intact.
    expect(result.entries).toHaveLength(3);
  });

  it("creates the notes folder if it is missing", async () => {
    const { harness, files } = await setup();
    await harness.callRpc("tree", null);
    expect(files.mkdir).toHaveBeenCalledWith({
      path: NOTES_ROOT,
      recursive: true,
    });
  });

  it("honours the configured rootDirectory setting", async () => {
    const { harness } = await setup({}, "/srv/vault");
    const result = await harness.callRpc("tree", null);
    expect(result.root).toBe("/srv/vault");
  });

  it("refuses a relative rootDirectory rather than guessing a folder", async () => {
    const { harness } = await setup({}, "notes");
    await expect(harness.callRpc("tree", null)).rejects.toThrow(
      /absolute path or start with/,
    );
  });
});

describe("writing notes", () => {
  it("passes the expected hash through for compare-and-swap", async () => {
    const { harness, files } = await setup();
    await harness.callRpc("write", {
      path: "work/plan.md",
      content: "updated",
      expectedSha256: "original",
    });
    expect(files.write).toHaveBeenCalledWith({
      path: path.join(NOTES_ROOT, "work/plan.md"),
      rootPath: NOTES_ROOT,
      content: "updated",
      contentEncoding: "utf8",
      createParents: true,
      expectedSha256: "original",
    });
  });

  it("surfaces a conflict rather than overwriting", async () => {
    const { harness } = await setup({
      write: vi.fn(() => ({ outcome: "conflict", currentSha256: "theirs" })),
    });
    const result = await harness.callRpc("write", {
      path: "a.md",
      content: "mine",
      expectedSha256: "original",
    });
    expect(result).toEqual({ outcome: "conflict", currentSha256: "theirs" });
  });

  it("refuses to write a non-Markdown path", async () => {
    const { harness, files } = await setup();
    await expect(
      harness.callRpc("write", {
        path: "config.json",
        content: "{}",
        expectedSha256: null,
      }),
    ).rejects.toThrow(/only writes Markdown/);
    expect(files.write).not.toHaveBeenCalled();
  });
});

describe("creating notes", () => {
  it("refuses to clobber an existing note", async () => {
    const { harness, files } = await setup();
    await expect(
      harness.callRpc("createFile", { path: "work/plan.md" }),
    ).rejects.toThrow(/already exists/);
    expect(files.write).not.toHaveBeenCalled();
  });

  it("creates the note when the path is free", async () => {
    const { harness, files } = await setup({
      read: vi.fn(() => {
        throw new Error("ENOENT");
      }),
    });
    const result = await harness.callRpc("createFile", { path: "fresh.md" });
    expect(result).toEqual({ path: "fresh.md", sha256: "new" });
    expect(files.write).toHaveBeenCalledWith(
      expect.objectContaining({ content: "", createParents: true }),
    );
  });

  it("requires a Markdown extension", async () => {
    const { harness } = await setup({
      read: vi.fn(() => {
        throw new Error("ENOENT");
      }),
    });
    await expect(
      harness.callRpc("createFile", { path: "notes.txt" }),
    ).rejects.toThrow(/Markdown extension/);
  });
});

describe("folders, renames and deletes", () => {
  it("creates a folder under the root", async () => {
    const { harness, files } = await setup();
    const result = await harness.callRpc("createDirectory", { path: "ideas" });
    expect(files.mkdir).toHaveBeenCalledWith({
      path: path.join(NOTES_ROOT, "ideas"),
      rootPath: NOTES_ROOT,
      recursive: true,
    });
    expect(result).toEqual({ path: "ideas" });
  });

  it("moves within the root", async () => {
    const { harness, files } = await setup();
    const result = await harness.callRpc("rename", {
      from: "a.md",
      to: "work/b.md",
    });
    expect(files.move).toHaveBeenCalledWith({
      sourcePath: path.join(NOTES_ROOT, "a.md"),
      destinationPath: path.join(NOTES_ROOT, "work/b.md"),
      rootPath: NOTES_ROOT,
    });
    expect(result).toEqual({ path: "work/b.md" });
  });

  it("refuses a rename whose destination escapes the root", async () => {
    const { harness, files } = await setup();
    await expect(
      harness.callRpc("rename", { from: "a.md", to: "../../evil.md" }),
    ).rejects.toThrow(/outside the notes folder/);
    expect(files.move).not.toHaveBeenCalled();
  });

  it("removes a note", async () => {
    const { harness, files } = await setup();
    await harness.callRpc("remove", { path: "a.md", recursive: false });
    expect(files.remove).toHaveBeenCalledWith({
      path: path.join(NOTES_ROOT, "a.md"),
      rootPath: NOTES_ROOT,
      recursive: false,
    });
  });

  it("refuses to delete the notes folder itself", async () => {
    const { harness, files } = await setup();
    await expect(
      harness.callRpc("remove", { path: ".", recursive: true }),
    ).rejects.toThrow(/cannot be deleted/);
    expect(files.remove).not.toHaveBeenCalled();
  });
});

describe("settings", () => {
  it("falls back to the imported VS Code defaults when there is no override", async () => {
    const { harness } = await setup({
      read: vi.fn(() => {
        throw new Error("ENOENT");
      }),
    });
    const result = await harness.callRpc("settings", null);
    expect(result.overridePath).toBeNull();
    expect(
      Object.keys(result.settings["highlight.regexes"] ?? {}),
    ).toHaveLength(6);
    expect(result.settings["markdown.extension.toc.orderedList"]).toBe(true);
  });

  it("merges a .vscode/settings.json override over the defaults", async () => {
    const { harness, files } = await setup({
      read: vi.fn(() => ({
        content: '{"editor.fontSize": 15 // bigger\n}',
        contentEncoding: "utf8",
        sizeBytes: 30,
        sha256: "s",
      })),
    });
    const result = await harness.callRpc("settings", null);
    expect(files.read).toHaveBeenCalledWith({
      path: path.join(NOTES_ROOT, ".vscode/settings.json"),
      rootPath: NOTES_ROOT,
    });
    expect(result.overridePath).toBe(".vscode/settings.json");
    expect(result.settings["editor.fontSize"]).toBe(15);
    // The override said nothing about highlighting, so the import survives.
    expect(
      Object.keys(result.settings["highlight.regexes"] ?? {}),
    ).toHaveLength(6);
  });

  it("ignores a malformed override instead of failing the panel", async () => {
    const { harness } = await setup({
      read: vi.fn(() => ({
        content: "{ this is not json",
        contentEncoding: "utf8",
        sizeBytes: 10,
        sha256: "s",
      })),
    });
    const result = await harness.callRpc("settings", null);
    expect(result.overridePath).toBeNull();
    expect(result.settings["markdown.extension.toc.orderedList"]).toBe(true);
  });
});
