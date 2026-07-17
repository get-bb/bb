// Docs — filesystem-first, multi-host Markdown and HTML vaults.
import { watch, type FSWatcher } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defineRpcContract,
  type BbPluginApi,
  type PluginRpcHandlers,
} from "@bb/plugin-sdk";
import { z } from "zod";

const DEFAULT_DIR = "~/Notes";
const PREVIEW_LENGTH = 100;
const MAX_TREE_ENTRIES = 5_000;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

interface Vault {
  id: string;
  name: string;
  hostId: string | null;
  rootPath: string;
}

interface VaultEntry {
  kind: "file" | "directory";
  path: string;
}

interface NoteSummary {
  path: string;
  title: string;
  preview: string;
  modifiedAtMs: number;
}

interface OpenerSource {
  kind: "workspace" | "host" | "thread-storage";
  threadId: string | null;
  environmentId: string | null;
  projectId: string | null;
}

interface ResolvedOpenerFile {
  path: string;
  rootPath: string;
  hostId: string | null;
}

const vaultIdSchema = z.string().min(1).optional();
const vaultSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    hostId: z.string().min(1).nullable(),
    rootPath: z.string().min(1),
  })
  .strict();
const vaultPathSchema = z.string().transform((value, context) => {
  try {
    return requireVaultPath(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : String(error),
    });
    return z.NEVER;
  }
});
const vaultDirectorySchema = z
  .union([z.literal(""), vaultPathSchema])
  .optional();
const openerSourceSchema = z
  .object({
    kind: z.enum(["workspace", "host", "thread-storage"]),
    threadId: z.string().nullable(),
    environmentId: z.string().nullable(),
    projectId: z.string().nullable(),
  })
  .strict();
const fileReadSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    contentEncoding: z.enum(["base64", "utf8"]),
    mimeType: z.string().optional(),
    sizeBytes: z.number().int().nonnegative(),
    modifiedAtMs: z.number().nonnegative().optional(),
    sha256: z.string(),
  })
  .strict();
const fileWriteSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("written"),
      sha256: z.string(),
      sizeBytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal("conflict"),
      currentSha256: z.string().nullable(),
    })
    .strict(),
]);
const previewSchema = z
  .object({
    baseUrl: z.string().min(1),
    expiresAtMs: z.number().nonnegative(),
  })
  .strict();
const hostSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal("persistent"),
    status: z.enum(["connected", "disconnected"]),
    lastSeenAt: z.number().nullable(),
    lastRejectedProtocolVersion: z.number().int().positive().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
const pathResultSchema = z.object({ path: z.string().min(1) }).strict();
const okResultSchema = z.object({ ok: z.literal(true) }).strict();

export const docsRpcContract = defineRpcContract({
  listNotes: {
    input: z.object({ vaultId: vaultIdSchema }).strict(),
    output: z
      .object({
        vaults: z.array(vaultSchema),
        vault: vaultSchema,
        hosts: z.array(hostSchema),
        entries: z.array(
          z
            .object({
              kind: z.enum(["file", "directory"]),
              path: z.string(),
            })
            .strict(),
        ),
        entryOrder: z.array(z.string()),
        notes: z.array(
          z
            .object({
              path: z.string(),
              title: z.string(),
              preview: z.string(),
              modifiedAtMs: z.number().nonnegative(),
            })
            .strict(),
        ),
        truncated: z.boolean(),
        error: z.string().nullable(),
      })
      .strict(),
  },
  readNote: {
    input: z.object({ vaultId: vaultIdSchema, path: vaultPathSchema }).strict(),
    output: fileReadSchema,
  },
  saveNote: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        path: vaultPathSchema,
        content: z.string(),
        expectedSha256: z.string().nullable().optional(),
      })
      .strict(),
    output: fileWriteSchema,
  },
  createNote: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        parent: vaultDirectorySchema,
        name: z.string().optional(),
        content: z.string().optional(),
      })
      .strict(),
    output: pathResultSchema,
  },
  deletePath: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        path: vaultPathSchema,
        recursive: z.boolean().optional(),
      })
      .strict(),
    output: okResultSchema,
  },
  createFolder: {
    input: z.object({ vaultId: vaultIdSchema, path: vaultPathSchema }).strict(),
    output: pathResultSchema,
  },
  reorderFiles: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        parent: vaultDirectorySchema,
        paths: z.array(vaultPathSchema),
      })
      .strict(),
    output: z.object({ paths: z.array(vaultPathSchema) }).strict(),
  },
  movePath: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        from: vaultPathSchema,
        to: vaultPathSchema,
      })
      .strict(),
    output: pathResultSchema,
  },
  renameToTitle: {
    input: z.object({ vaultId: vaultIdSchema, path: vaultPathSchema }).strict(),
    output: pathResultSchema,
  },
  createVault: {
    input: z
      .object({
        name: z.string().min(1),
        rootPath: z.string().min(1),
        hostId: z.string().min(1).optional(),
      })
      .strict(),
    output: vaultSchema,
  },
  removeVault: {
    input: z.object({ vaultId: z.string().min(1) }).strict(),
    output: okResultSchema,
  },
  uploadAttachment: {
    input: z
      .object({
        vaultId: vaultIdSchema,
        notePath: vaultPathSchema,
        content: z.string().min(1),
        name: z.string().min(1),
      })
      .strict(),
    output: z
      .object({
        path: z.string().min(1),
        markdownPath: z.string().min(1),
        result: fileWriteSchema,
      })
      .strict(),
  },
  preparePreview: {
    input: z.object({ vaultId: vaultIdSchema, path: vaultPathSchema }).strict(),
    output: previewSchema,
  },
  openFile: {
    input: z
      .object({ source: openerSourceSchema, path: z.string().min(1) })
      .strict(),
    output: z
      .object({
        file: fileReadSchema,
        preview: previewSchema,
        previewPath: z.string(),
      })
      .strict(),
  },
  saveOpenedFile: {
    input: z
      .object({
        source: openerSourceSchema,
        path: z.string().min(1),
        content: z.string(),
        expectedSha256: z.string().nullable().optional(),
      })
      .strict(),
    output: fileWriteSchema,
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Expected an object");
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`"${field}" must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseOpenerSource(value: unknown): OpenerSource {
  const source = requireRecord(value);
  if (
    source.kind !== "workspace" &&
    source.kind !== "host" &&
    source.kind !== "thread-storage"
  ) {
    throw new Error('"source.kind" must be workspace, host, or thread-storage');
  }
  return {
    kind: source.kind,
    threadId: typeof source.threadId === "string" ? source.threadId : null,
    environmentId:
      typeof source.environmentId === "string" ? source.environmentId : null,
    projectId: typeof source.projectId === "string" ? source.projectId : null,
  };
}

function expandHome(rawPath: string): string {
  if (rawPath === "~") return os.homedir();
  if (rawPath.startsWith("~/"))
    return path.join(os.homedir(), rawPath.slice(2));
  return rawPath;
}

function requireVaultPath(
  value: unknown,
  options?: { extension?: string },
): string {
  const raw = requireString(value, "path").replace(/\\/g, "/");
  if (raw.startsWith("/") || /^[a-zA-Z]:\//.test(raw) || raw.includes("\0")) {
    throw new Error(`Invalid vault path: ${raw}`);
  }
  const segments = raw.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith("."),
    )
  ) {
    throw new Error(`Invalid vault path: ${raw}`);
  }
  const normalized = path.posix.normalize(raw);
  if (
    options?.extension &&
    !normalized.toLowerCase().endsWith(options.extension)
  ) {
    throw new Error(`Path must end with ${options.extension}: ${normalized}`);
  }
  return normalized;
}

function requireOptionalDirectory(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return requireVaultPath(value);
}

function absolutePath(vault: Vault, relativePath: string): string {
  const parts = relativePath.split("/");
  return /^[a-zA-Z]:[\\/]/.test(vault.rootPath) ||
    vault.rootPath.startsWith("\\\\")
    ? path.win32.join(vault.rootPath, ...parts)
    : path.posix.join(vault.rootPath, ...parts);
}

function isAbsoluteHostPath(value: string): boolean {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function normalizeHostRoot(value: string): string {
  return path.win32.isAbsolute(value) && !path.posix.isAbsolute(value)
    ? path.win32.normalize(value)
    : path.posix.normalize(value);
}

function hostArgs(vault: Vault): { hostId?: string } {
  return vault.hostId ? { hostId: vault.hostId } : {};
}

function cleanLine(line: string): string {
  return line
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .trim();
}

function deriveTitle(content: string, fallback: string): string {
  for (const line of content.split("\n")) {
    const stripped = cleanLine(line);
    if (stripped && !stripped.startsWith("::html{"))
      return stripped.slice(0, 120);
  }
  return fallback;
}

function derivePreview(content: string, title: string): string {
  return content
    .split("\n")
    .map(cleanLine)
    .filter((line) => line && line !== title && !line.startsWith("::html{"))
    .join(" ")
    .slice(0, PREVIEW_LENGTH);
}

function kebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

function sanitizeName(raw: string): string {
  return raw
    .replace(/\.(md|html?)$/i, "")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function parseVaultRow(value: unknown): Vault {
  const row = requireRecord(value);
  return {
    id: requireString(row.id, "id"),
    name: requireString(row.name, "name"),
    hostId: typeof row.host_id === "string" && row.host_id ? row.host_id : null,
    rootPath: requireString(row.root_path, "root_path"),
  };
}

function parseCli(argv: string[]): {
  command: string;
  positionals: string[];
  vaultId?: string;
  content?: string;
  recursive: boolean;
  json: boolean;
} {
  const positionals: string[] = [];
  let vaultId: string | undefined;
  let content: string | undefined;
  let recursive = false;
  let json = false;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--vault") vaultId = argv[++index];
    else if (arg === "--content") content = argv[++index] ?? "";
    else if (arg === "--recursive") recursive = true;
    else if (arg === "--json") json = true;
    else positionals.push(arg);
  }
  return {
    command: argv[0] ?? "help",
    positionals,
    vaultId,
    content,
    recursive,
    json,
  };
}

function waitForDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    directory: {
      type: "string",
      label: "Legacy/default Docs folder (~ ok)",
      default: DEFAULT_DIR,
    },
  });
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS vaults (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host_id TEXT,
      root_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS entry_order (
      vault_id TEXT NOT NULL,
      parent_path TEXT NOT NULL,
      child_path TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (vault_id, parent_path, child_path)
    )`,
  ]);

  let seededDefaultVault = false;
  if (
    Number(db.prepare("SELECT COUNT(*) AS count FROM vaults").pluck().get()) ===
    0
  ) {
    const { directory } = await settings.get();
    const rootPath = path.resolve(expandHome(directory.trim() || DEFAULT_DIR));
    db.prepare(
      "INSERT INTO vaults (id, name, host_id, root_path, created_at) VALUES (?, ?, NULL, ?, ?)",
    ).run("personal", "Personal", rootPath, Date.now());
    seededDefaultVault = true;
  }

  function listVaults(): Vault[] {
    return db
      .prepare(
        "SELECT id, name, host_id, root_path FROM vaults ORDER BY created_at, name",
      )
      .all()
      .map(parseVaultRow);
  }

  function getVault(vaultId?: string): Vault {
    const vaults = listVaults();
    const vault = vaultId
      ? vaults.find((candidate) => candidate.id === vaultId)
      : vaults[0];
    if (!vault)
      throw new Error(
        vaultId ? `Unknown vault: ${vaultId}` : "No vault configured",
      );
    return vault;
  }

  function listEntryOrder(vaultId: string): string[] {
    return db
      .prepare(
        "SELECT child_path FROM entry_order WHERE vault_id = ? ORDER BY parent_path, position",
      )
      .all(vaultId)
      .map((row) => requireString(requireRecord(row).child_path, "child_path"));
  }

  if (seededDefaultVault) {
    const vault = getVault("personal");
    try {
      await bb.sdk.files.mkdir({ path: vault.rootPath, recursive: true });
    } catch (error) {
      bb.log.warn(
        `could not create default vault: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function listEntries(
    vault: Vault,
  ): Promise<{ entries: VaultEntry[]; truncated: boolean }> {
    const result = await bb.sdk.files.listPaths({
      ...hostArgs(vault),
      path: vault.rootPath,
      includeFiles: true,
      includeDirectories: true,
      limit: MAX_TREE_ENTRIES,
    });
    return {
      entries: result.paths
        .filter(
          (entry) =>
            entry.kind === "directory" || /\.(md|html?)$/i.test(entry.path),
        )
        .map((entry) => ({
          kind: entry.kind,
          path: entry.path.replace(/\\/g, "/"),
        })),
      truncated: result.truncated,
    };
  }

  async function listNoteSummaries(
    vault: Vault,
    knownEntries?: VaultEntry[],
  ): Promise<NoteSummary[]> {
    const entries = knownEntries ?? (await listEntries(vault)).entries;
    const notes: NoteSummary[] = [];
    const markdownPaths = entries
      .filter((entry) => entry.kind === "file" && /\.md$/i.test(entry.path))
      .map((entry) => entry.path);
    for (const notePath of markdownPaths) {
      try {
        const file = await bb.sdk.files.read({
          ...hostArgs(vault),
          path: absolutePath(vault, notePath),
          rootPath: vault.rootPath,
        });
        const fallback = path.posix.basename(notePath).replace(/\.md$/i, "");
        const title = deriveTitle(file.content, fallback);
        notes.push({
          path: notePath,
          title,
          preview: derivePreview(file.content, title),
          modifiedAtMs: file.modifiedAtMs ?? 0,
        });
      } catch {
        // Files may disappear during a recursive refresh.
      }
    }
    return notes.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
  }

  async function notebookData(vaultId?: string) {
    const vault = getVault(vaultId);
    try {
      const [{ entries, truncated }, hosts] = await Promise.all([
        listEntries(vault),
        bb.sdk.hosts.list(),
      ]);
      const notes = await listNoteSummaries(vault, entries);
      return {
        vaults: listVaults(),
        vault,
        hosts,
        entries,
        entryOrder: listEntryOrder(vault.id),
        notes,
        truncated,
        error: null,
      };
    } catch (error) {
      return {
        vaults: listVaults(),
        vault,
        hosts: await bb.sdk.hosts.list().catch(() => []),
        entries: [],
        entryOrder: listEntryOrder(vault.id),
        notes: [],
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function readFile(vaultId: string | undefined, rawPath: unknown) {
    const vault = getVault(vaultId);
    const relativePath = requireVaultPath(rawPath);
    const file = await bb.sdk.files.read({
      ...hostArgs(vault),
      path: absolutePath(vault, relativePath),
      rootPath: vault.rootPath,
    });
    return { ...file, path: relativePath };
  }

  async function writeFile(args: {
    vaultId?: string;
    rawPath: unknown;
    content: unknown;
    contentEncoding?: "utf8" | "base64";
    expectedSha256?: unknown;
    createOnly?: boolean;
  }) {
    const vault = getVault(args.vaultId);
    const relativePath = requireVaultPath(args.rawPath);
    if (typeof args.content !== "string")
      throw new Error('"content" must be a string');
    const result = await bb.sdk.files.write({
      ...hostArgs(vault),
      path: absolutePath(vault, relativePath),
      rootPath: vault.rootPath,
      content: args.content,
      contentEncoding: args.contentEncoding ?? "utf8",
      createParents: true,
      ...(args.createOnly
        ? { expectedSha256: null }
        : args.expectedSha256 === null ||
            typeof args.expectedSha256 === "string"
          ? { expectedSha256: args.expectedSha256 }
          : {}),
    });
    if (result.outcome === "written") {
      bb.realtime.publish("vault-changed", { vaultId: vault.id });
    }
    return result;
  }

  async function resolveOpenerFile(
    sourceValue: unknown,
    pathValue: unknown,
  ): Promise<ResolvedOpenerFile> {
    const source = parseOpenerSource(sourceValue);
    const filePath = requireString(pathValue, "path");
    if (source.kind === "host") {
      if (!isAbsoluteHostPath(filePath)) {
        throw new Error("Host file paths must be absolute");
      }
      const normalized = normalizeHostRoot(filePath);
      const pathApi = path.win32.isAbsolute(normalized)
        ? path.win32
        : path.posix;
      return {
        path: normalized,
        rootPath: pathApi.dirname(normalized),
        hostId: null,
      };
    }
    if (source.kind === "workspace" && source.environmentId) {
      const environment = await bb.sdk.environments.get({
        environmentId: source.environmentId,
      });
      if (!environment.path) {
        throw new Error("This environment has no workspace path");
      }
      return {
        path: path.join(environment.path, filePath),
        rootPath: environment.path,
        hostId: environment.hostId,
      };
    }
    throw new Error("Docs can open workspace and host files only");
  }

  async function createNote(
    vaultId: string | undefined,
    input: Record<string, unknown>,
  ) {
    const vault = getVault(vaultId);
    const parent = requireOptionalDirectory(input.parent);
    const base =
      sanitizeName(typeof input.name === "string" ? input.name : "") ||
      "Untitled";
    const { entries } = await listEntries(vault);
    const existing = new Set(entries.map((entry) => entry.path.toLowerCase()));
    let relativePath = parent ? `${parent}/${base}.md` : `${base}.md`;
    let counter = 2;
    while (existing.has(relativePath.toLowerCase())) {
      relativePath = parent
        ? `${parent}/${base} ${counter}.md`
        : `${base} ${counter}.md`;
      counter += 1;
    }
    await writeFile({
      vaultId: vault.id,
      rawPath: relativePath,
      content: typeof input.content === "string" ? input.content : "",
      createOnly: true,
    });
    return { path: relativePath };
  }

  async function movePath(
    vaultId: string | undefined,
    fromValue: unknown,
    toValue: unknown,
  ) {
    const vault = getVault(vaultId);
    const from = requireVaultPath(fromValue);
    const to = requireVaultPath(toValue);
    await bb.sdk.files.move({
      ...hostArgs(vault),
      sourcePath: absolutePath(vault, from),
      destinationPath: absolutePath(vault, to),
      rootPath: vault.rootPath,
    });
    bb.realtime.publish("vault-changed", { vaultId: vault.id });
    return { path: to };
  }

  async function removePath(
    vaultId: string | undefined,
    rawPath: unknown,
    recursive = false,
  ): Promise<{ ok: true }> {
    const vault = getVault(vaultId);
    const relativePath = requireVaultPath(rawPath);
    await bb.sdk.files.remove({
      ...hostArgs(vault),
      path: absolutePath(vault, relativePath),
      rootPath: vault.rootPath,
      recursive,
    });
    bb.realtime.publish("vault-changed", { vaultId: vault.id });
    return { ok: true };
  }

  const handlers: PluginRpcHandlers<typeof docsRpcContract> = {
    async listNotes(input) {
      return notebookData(input.vaultId);
    },
    async readNote(input) {
      return readFile(input.vaultId, input.path);
    },
    async saveNote(input) {
      return writeFile({
        vaultId: input.vaultId,
        rawPath: input.path,
        content: input.content,
        expectedSha256: input.expectedSha256,
      });
    },
    async createNote(input) {
      return createNote(input.vaultId, input);
    },
    async deletePath(input) {
      return removePath(input.vaultId, input.path, input.recursive === true);
    },
    async createFolder(input) {
      const vault = getVault(input.vaultId);
      const relativePath = requireVaultPath(input.path);
      await bb.sdk.files.mkdir({
        ...hostArgs(vault),
        path: absolutePath(vault, relativePath),
        rootPath: vault.rootPath,
        recursive: false,
      });
      bb.realtime.publish("vault-changed", { vaultId: vault.id });
      return { path: relativePath };
    },
    async reorderFiles(input) {
      const vault = getVault(input.vaultId);
      const parent = requireOptionalDirectory(input.parent);
      const paths = input.paths.map((value) => requireVaultPath(value));
      if (new Set(paths).size !== paths.length) {
        throw new Error('"paths" must not contain duplicates');
      }
      if (
        paths.some(
          (filePath) =>
            path.posix.dirname(filePath) !== (parent || ".") ||
            !/\.(md|html?)$/i.test(filePath),
        )
      ) {
        throw new Error('Every ordered path must be a file in "parent"');
      }
      const currentFiles = (await listEntries(vault)).entries
        .filter(
          (entry) =>
            entry.kind === "file" &&
            path.posix.dirname(entry.path) === (parent || "."),
        )
        .map((entry) => entry.path);
      if (
        paths.length !== currentFiles.length ||
        currentFiles.some((filePath) => !paths.includes(filePath))
      ) {
        throw new Error(
          "Files changed while reordering; refresh and try again",
        );
      }
      const replaceOrder = db.transaction(() => {
        db.prepare(
          "DELETE FROM entry_order WHERE vault_id = ? AND parent_path = ?",
        ).run(vault.id, parent);
        const insert = db.prepare(
          "INSERT INTO entry_order (vault_id, parent_path, child_path, position) VALUES (?, ?, ?, ?)",
        );
        paths.forEach((filePath, position) =>
          insert.run(vault.id, parent, filePath, position),
        );
      });
      replaceOrder();
      bb.realtime.publish("vault-changed", { vaultId: vault.id });
      return { paths };
    },
    async movePath(input) {
      return movePath(input.vaultId, input.from, input.to);
    },
    async renameToTitle(input) {
      const vaultId = input.vaultId;
      const currentPath = requireVaultPath(input.path, { extension: ".md" });
      const file = await readFile(vaultId, currentPath);
      const base = kebabCase(deriveTitle(file.content, ""));
      if (!base) return { path: currentPath };
      const parent = path.posix.dirname(currentPath);
      const desired = parent === "." ? `${base}.md` : `${parent}/${base}.md`;
      if (desired.toLowerCase() === currentPath.toLowerCase())
        return { path: currentPath };
      try {
        return await movePath(vaultId, currentPath, desired);
      } catch {
        return { path: currentPath };
      }
    },
    async createVault(input) {
      const name = requireString(input.name, "name");
      const rootPath = requireString(input.rootPath, "rootPath");
      if (!isAbsoluteHostPath(rootPath))
        throw new Error('"rootPath" must be absolute');
      const hostId = optionalString(input.hostId) ?? null;
      const resolvedRoot = normalizeHostRoot(rootPath);
      await bb.sdk.files.mkdir({
        ...(hostId ? { hostId } : {}),
        path: resolvedRoot,
        recursive: true,
      });
      const baseId = kebabCase(name) || "vault";
      const ids = new Set(listVaults().map((vault) => vault.id));
      let id = baseId;
      let counter = 2;
      while (ids.has(id)) id = `${baseId}-${counter++}`;
      db.prepare(
        "INSERT INTO vaults (id, name, host_id, root_path, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, name, hostId, resolvedRoot, Date.now());
      bb.realtime.publish("vault-changed", { vaultId: id });
      return getVault(id);
    },
    async removeVault(input) {
      const id = requireString(input.vaultId, "vaultId");
      if (listVaults().length <= 1)
        throw new Error("At least one vault is required");
      db.prepare("DELETE FROM entry_order WHERE vault_id = ?").run(id);
      db.prepare("DELETE FROM vaults WHERE id = ?").run(id);
      bb.realtime.publish("vault-changed", { vaultId: id });
      return { ok: true };
    },
    async uploadAttachment(input) {
      const vaultId = input.vaultId;
      const notePath = requireVaultPath(input.notePath, { extension: ".md" });
      const content = requireString(input.content, "content");
      const bytes = Buffer.from(content, "base64");
      if (bytes.length > MAX_ATTACHMENT_BYTES)
        throw new Error("Attachment exceeds 20 MB");
      const rawName = requireString(input.name, "name");
      const extension = path.extname(rawName).toLowerCase();
      const original =
        sanitizeName(path.basename(rawName, extension)) || "image";
      if (
        !new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]).has(
          extension,
        )
      ) {
        throw new Error("Unsupported image type");
      }
      const parent = path.posix.dirname(notePath);
      const attachment = `${original}-${Date.now().toString(36)}${extension}`;
      const relativePath =
        parent === "."
          ? `_attachments/${attachment}`
          : `${parent}/_attachments/${attachment}`;
      const result = await writeFile({
        vaultId,
        rawPath: relativePath,
        content,
        contentEncoding: "base64",
        createOnly: true,
      });
      return {
        path: relativePath,
        markdownPath: `./_attachments/${attachment}`,
        result,
      };
    },
    async preparePreview(input) {
      const vault = getVault(input.vaultId);
      const relativePath = requireVaultPath(input.path);
      await bb.sdk.files.read({
        ...hostArgs(vault),
        path: absolutePath(vault, relativePath),
        rootPath: vault.rootPath,
      });
      return bb.sdk.files.createPreview({
        ...hostArgs(vault),
        rootPath: vault.rootPath,
      });
    },
    async openFile(input) {
      const target = await resolveOpenerFile(input.source, input.path);
      const args = {
        ...(target.hostId ? { hostId: target.hostId } : {}),
        path: target.path,
        rootPath: target.rootPath,
      };
      const [file, preview] = await Promise.all([
        bb.sdk.files.read(args),
        bb.sdk.files.createPreview({
          ...(target.hostId ? { hostId: target.hostId } : {}),
          rootPath: target.rootPath,
        }),
      ]);
      const pathApi = path.win32.isAbsolute(target.rootPath)
        ? path.win32
        : path.posix;
      return {
        file,
        preview,
        previewPath: pathApi
          .relative(target.rootPath, target.path)
          .replace(/\\/g, "/"),
      };
    },
    async saveOpenedFile(input) {
      const target = await resolveOpenerFile(input.source, input.path);
      return bb.sdk.files.write({
        ...(target.hostId ? { hostId: target.hostId } : {}),
        path: target.path,
        rootPath: target.rootPath,
        content: input.content,
        ...(input.expectedSha256 === null ||
        typeof input.expectedSha256 === "string"
          ? { expectedSha256: input.expectedSha256 }
          : {}),
      });
    },
  };

  bb.rpc.register(docsRpcContract, handlers);

  async function readHttpInput<Schema extends z.ZodType>(
    context: Parameters<Parameters<BbPluginApi["http"]["route"]>[2]>[0],
    schema: Schema,
  ): Promise<
    { ok: true; value: z.output<Schema> } | { ok: false; response: Response }
  > {
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      return {
        ok: false,
        response: context.json(
          {
            ok: false,
            error: {
              code: "invalid_json",
              message: "request body must be JSON",
            },
          },
          400,
        ),
      };
    }
    const result = await schema.safeParseAsync(input);
    if (result.success) return { ok: true, value: result.data };
    return {
      ok: false,
      response: context.json(
        {
          ok: false,
          error: {
            code: "invalid_input",
            message: "request input validation failed",
            issues: result.error.issues.map((issue) => ({
              message: issue.message,
              ...(issue.path.length > 0 ? { path: issue.path } : {}),
            })),
          },
        },
        400,
      ),
    };
  }

  bb.http.route(
    "POST",
    "/list",
    async (context) => {
      const input = await readHttpInput(
        context,
        docsRpcContract.listNotes.input,
      );
      if (!input.ok) return input.response;
      return context.json(await handlers.listNotes(input.value));
    },
    { auth: "token" },
  );
  bb.http.route(
    "POST",
    "/read",
    async (context) => {
      const input = await readHttpInput(
        context,
        docsRpcContract.readNote.input,
      );
      if (!input.ok) return input.response;
      return context.json(await handlers.readNote(input.value));
    },
    { auth: "token" },
  );
  bb.http.route(
    "POST",
    "/write",
    async (context) => {
      const input = await readHttpInput(
        context,
        docsRpcContract.saveNote.input,
      );
      if (!input.ok) return input.response;
      return context.json(await handlers.saveNote(input.value));
    },
    { auth: "token" },
  );
  bb.http.route(
    "POST",
    "/mkdir",
    async (context) => {
      const input = await readHttpInput(
        context,
        docsRpcContract.createFolder.input,
      );
      if (!input.ok) return input.response;
      return context.json(await handlers.createFolder(input.value));
    },
    { auth: "token" },
  );
  bb.http.route(
    "POST",
    "/move",
    async (context) => {
      const input = await readHttpInput(
        context,
        docsRpcContract.movePath.input,
      );
      if (!input.ok) return input.response;
      return context.json(await handlers.movePath(input.value));
    },
    { auth: "token" },
  );
  bb.http.route(
    "POST",
    "/remove",
    async (context) => {
      const input = await readHttpInput(
        context,
        docsRpcContract.deletePath.input,
      );
      if (!input.ok) return input.response;
      return context.json(await handlers.deletePath(input.value));
    },
    { auth: "token" },
  );

  bb.cli.register({
    name: "docs",
    summary: "Read and update Docs vaults",
    commands: [
      {
        name: "vaults",
        summary: "List configured vaults",
        usage: "bb docs vaults [--json]",
      },
      {
        name: "vault-add",
        summary: "Add a vault",
        usage: "bb docs vault-add <name> <absolute-root> [host-id]",
      },
      {
        name: "vault-remove",
        summary: "Remove a vault configuration",
        usage: "bb docs vault-remove <id>",
      },
      {
        name: "list",
        summary: "List notes and folders",
        usage: "bb docs list [--vault <id>] [--json]",
      },
      {
        name: "read",
        summary: "Read a file",
        usage: "bb docs read <path> [--vault <id>]",
      },
      {
        name: "write",
        summary: "Write a UTF-8 file",
        usage: "bb docs write <path> --content <text> [--vault <id>]",
      },
      {
        name: "mkdir",
        summary: "Create a folder",
        usage: "bb docs mkdir <path> [--vault <id>]",
      },
      {
        name: "move",
        summary: "Move a path",
        usage: "bb docs move <from> <to> [--vault <id>]",
      },
      {
        name: "remove",
        summary: "Remove a file or directory",
        usage: "bb docs remove <path> [--vault <id>] [--recursive]",
      },
    ],
    async run(argv) {
      try {
        const args = parseCli(argv);
        let result: unknown;
        if (args.command === "vaults") result = listVaults();
        else if (args.command === "vault-add")
          result = await handlers.createVault({
            name: args.positionals[0],
            rootPath: args.positionals[1],
            hostId: args.positionals[2],
          });
        else if (args.command === "vault-remove")
          result = await handlers.removeVault({ vaultId: args.positionals[0] });
        else if (args.command === "list")
          result = await notebookData(args.vaultId);
        else if (args.command === "read")
          result = await readFile(args.vaultId, args.positionals[0]);
        else if (args.command === "write") {
          if (args.content === undefined)
            throw new Error("write requires --content <text>");
          result = await writeFile({
            vaultId: args.vaultId,
            rawPath: args.positionals[0],
            content: args.content,
          });
        } else if (args.command === "mkdir") {
          result = await handlers.createFolder({
            vaultId: args.vaultId,
            path: args.positionals[0],
          });
        } else if (args.command === "move") {
          result = await movePath(
            args.vaultId,
            args.positionals[0],
            args.positionals[1],
          );
        } else if (args.command === "remove") {
          result = await removePath(
            args.vaultId,
            args.positionals[0],
            args.recursive,
          );
        } else {
          return {
            exitCode: 1,
            stderr:
              "Usage: bb docs <vaults|vault-add|vault-remove|list|read|write|mkdir|move|remove>",
          };
        }
        const output =
          args.command === "read" &&
          !args.json &&
          isRecord(result) &&
          typeof result.content === "string"
            ? result.content
            : JSON.stringify(result, null, 2);
        return { exitCode: 0, stdout: output };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  bb.ui.registerMentionProvider({
    id: "note",
    label: "Docs",
    async search({ query }) {
      const needle = query.trim().toLowerCase();
      const matches = [];
      for (const vault of listVaults()) {
        for (const note of await listNoteSummaries(vault)) {
          if (
            needle &&
            !`${vault.name} ${note.title} ${note.preview} ${note.path}`
              .toLowerCase()
              .includes(needle)
          )
            continue;
          matches.push({
            id: `${vault.id}:${note.path}`,
            title: note.title,
            subtitle: `${vault.name} · ${note.preview || note.path}`,
            icon: "FileText",
          });
          if (matches.length === 25) return matches;
        }
      }
      return matches;
    },
    async resolve(itemId) {
      const separator = itemId.indexOf(":");
      if (separator < 1) throw new Error("Invalid note mention");
      const vaultId = itemId.slice(0, separator);
      const relativePath = itemId.slice(separator + 1);
      const file = await readFile(vaultId, relativePath);
      return {
        context: `Docs document (${vaultId}/${relativePath}):\n\n${file.content}`,
      };
    },
  });

  bb.background.service("watch-vaults", {
    async start(signal) {
      const watchers = new Map<string, FSWatcher>();
      const retryNative = new Set<string>();
      let debounce: NodeJS.Timeout | null = null;
      let previous = "";
      try {
        while (!signal.aborted) {
          const vaults = listVaults();
          const localIds = new Set(
            vaults.filter((vault) => !vault.hostId).map((vault) => vault.id),
          );
          for (const [vaultId, watcher] of watchers) {
            if (!localIds.has(vaultId)) {
              watcher.close();
              watchers.delete(vaultId);
            }
          }
          for (const vault of vaults) {
            if (vault.hostId || watchers.has(vault.id)) continue;
            try {
              const watcher = watch(vault.rootPath, { recursive: true }, () => {
                if (debounce) clearTimeout(debounce);
                debounce = setTimeout(() => {
                  bb.realtime.publish("vault-changed", {
                    vaultId: vault.id,
                  });
                }, 250);
              });
              watcher.on("error", () => {
                watcher.close();
                watchers.delete(vault.id);
                retryNative.add(vault.id);
              });
              watchers.set(vault.id, watcher);
              retryNative.delete(vault.id);
            } catch (error) {
              if (!retryNative.has(vault.id)) {
                bb.log.warn(
                  `cannot watch ${vault.rootPath}; using polling: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
              retryNative.add(vault.id);
            }
          }

          const snapshots: string[] = [];
          for (const vault of vaults) {
            if (watchers.has(vault.id)) continue;
            try {
              const { entries } = await listEntries(vault);
              const notes = await listNoteSummaries(vault, entries);
              snapshots.push(
                JSON.stringify({
                  id: vault.id,
                  entries: entries.map(
                    (entry) => `${entry.kind}:${entry.path}`,
                  ),
                  notes: notes.map(
                    (note) => `${note.path}:${note.modifiedAtMs}`,
                  ),
                }),
              );
            } catch {
              snapshots.push(`${vault.id}:offline`);
            }
          }
          const next = snapshots.join("\n");
          if (previous && previous !== next) {
            bb.realtime.publish("vault-changed", {});
          }
          previous = next;
          await waitForDelay(10_000, signal);
        }
      } finally {
        if (debounce) clearTimeout(debounce);
        for (const watcher of watchers.values()) watcher.close();
      }
    },
  });
}
