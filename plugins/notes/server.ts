import os from "node:os";
import path from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  defineRpcContract,
  type BbPluginApi,
  type PluginCliContext,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  DEFAULT_NOTES_DIRECTORY,
  relativeToRoot,
  resolveNotesRoot,
  resolveWithinRoot,
} from "./lib/notes-path.js";
import {
  IMPORTED_VSCODE_SETTINGS,
  mergeSettings,
  notesSettingsSchema,
  parseSettings,
  type NotesSettings,
} from "./lib/vscode-settings.js";
import { isMarkdownPath } from "./lib/notes-tree.js";

const MAX_EDITABLE_BYTES = 8 * 1024 * 1024;

const MAX_TREE_ENTRIES = 10_000;

const ASSET_LEASE_TTL_MS = 60 * 60 * 1000;

const ASSET_LEASE_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * A VS Code-compatible location, so a user can drop the same
 * `settings.json` they already keep in a project into their notes folder and
 * have it picked up.
 */
const SETTINGS_RELATIVE_PATH = ".vscode/settings.json";

const relativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !value.startsWith("/"), {
    message: "Note paths must be relative to the notes folder",
  });

export const rpcContract = defineRpcContract({
  assets: {
    input: z.null(),
    output: z.object({ baseUrl: z.string(), expiresAtMs: z.number() }),
  },
  settings: {
    input: z.null(),
    output: z.object({
      root: z.string(),
      settings: notesSettingsSchema,
      /** Where an override was found, null when only defaults applied. */
      overridePath: z.string().nullable(),
    }),
  },
  tree: {
    input: z.null(),
    output: z.object({
      root: z.string(),
      entries: z.array(
        z.object({
          path: z.string(),
          kind: z.enum(["file", "directory"]),
        }),
      ),
      truncated: z.boolean(),
    }),
  },
  read: {
    input: z.object({ path: relativePathSchema }).strict(),
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("text"),
        content: z.string(),
        sha256: z.string(),
        path: z.string(),
      }),
      z.object({ kind: z.literal("unsupported"), reason: z.string() }),
    ]),
  },
  write: {
    input: z
      .object({
        path: relativePathSchema,
        content: z.string(),
        expectedSha256: z.string().nullable(),
      })
      .strict(),
    output: z.discriminatedUnion("outcome", [
      z.object({ outcome: z.literal("written"), sha256: z.string() }),
      z.object({
        outcome: z.literal("conflict"),
        currentSha256: z.string().nullable(),
      }),
    ]),
  },
  createFile: {
    input: z.object({ path: relativePathSchema }).strict(),
    output: z.object({ path: z.string(), sha256: z.string() }),
  },
  createDirectory: {
    input: z.object({ path: relativePathSchema }).strict(),
    output: z.object({ path: z.string() }),
  },
  rename: {
    input: z
      .object({ from: relativePathSchema, to: relativePathSchema })
      .strict(),
    output: z.object({ path: z.string() }),
  },
  remove: {
    input: z
      .object({ path: relativePathSchema, recursive: z.boolean() })
      .strict(),
    output: z.object({ path: z.string() }),
  },
});

function isBundleStale(moduleDir: string, bundleDir: string): boolean {
  const builtAtMs = statSync(path.join(bundleDir, "editor.js")).mtimeMs;
  const entryDir = path.join(moduleDir, "monaco-bundle");
  if (!existsSync(entryDir)) return false;

  const inputs = [
    path.join(moduleDir, "scripts", "stage-assets.mjs"),
    ...readdirSync(entryDir).map((name) => path.join(entryDir, name)),
    path.join(moduleDir, "package.json"),
  ];
  return inputs.some(
    (input) => existsSync(input) && statSync(input).mtimeMs > builtAtMs,
  );
}

async function ensureMonacoBundleDir(
  log: (message: string) => void,
): Promise<string> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(moduleDir, "monaco"),
    path.join(moduleDir, "dist", "monaco"),
  ];
  const built = candidates.find((candidate) =>
    existsSync(path.join(candidate, "editor.js")),
  );
  if (built !== undefined && !isBundleStale(moduleDir, built)) return built;

  log(
    built === undefined
      ? "Notes Monaco bundle missing; building it (first run in a source checkout)"
      : "Notes Monaco bundle is older than its sources; rebuilding it",
  );
  const script = new URL("./scripts/stage-assets.mjs", import.meta.url).href;
  await import(script);

  const staged = candidates.find((candidate) =>
    existsSync(path.join(candidate, "editor.js")),
  );
  if (staged === undefined) {
    throw new Error(
      "could not build the Notes Monaco bundle; run `pnpm --filter bb-plugin-notes build:monaco`",
    );
  }
  return staged;
}

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      if (rawName === undefined || rawName === "") {
        throw new Error(`Invalid flag ${arg}`);
      }
      if (inlineValue !== undefined) {
        flags.set(rawName, inlineValue);
        continue;
      }
      const next = rest[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(rawName, next);
        index += 1;
        continue;
      }
      flags.set(rawName, true);
      continue;
    }
    positionals.push(arg);
  }
  return { command, positionals, flags };
}

function flagValue(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function requirePositional(parsed: ParsedArgs, label: string): string {
  const value = parsed.positionals[0];
  if (value === undefined || value === "") throw new Error(`Missing ${label}.`);
  return value;
}

const CLI_USAGE = `Usage: bb notes <list|read|write|new|mkdir|move|remove|settings|root>

  bb notes root                            Print the notes folder
  bb notes settings [--json]               Show the effective editor settings
  bb notes list [--all] [--json]           List notes (--all includes folders)
  bb notes read <path>                     Print a note
  bb notes write <path> --content <text>   Overwrite a note
  bb notes new <path>                      Create an empty note
  bb notes mkdir <path>                    Create a folder
  bb notes move <from> <to>                Rename or move a note or folder
  bb notes remove <path> [--recursive]     Delete a note or folder
`;

export default async function plugin(bb: BbPluginApi) {
  let assetLease: { baseUrl: string; expiresAtMs: number } | null = null;

  const settingsStore = bb.settings.define({
    rootDirectory: {
      type: "string",
      label: "Notes folder",
      default: DEFAULT_NOTES_DIRECTORY,
      experimental_schema: z
        .string()
        .min(1, "A notes folder path is required")
        .max(1024, "That path is too long"),
    },
  });

  /**
   * Read per request rather than cached, so changing the setting takes
   * effect without restarting the plugin.
   */
  async function rootDirectory(): Promise<string> {
    const values = await settingsStore.get();
    return resolveNotesRoot({
      rawPath: values.rootDirectory,
      homeDirectory: os.homedir(),
    });
  }

  async function assets() {
    const now = Date.now();
    if (
      assetLease === null ||
      assetLease.expiresAtMs - now < ASSET_LEASE_REFRESH_MARGIN_MS
    ) {
      const bundleDir = await ensureMonacoBundleDir((message) =>
        bb.log.info(message),
      );
      assetLease = await bb.sdk.files.createPreview({
        rootPath: bundleDir,
        ttlMs: ASSET_LEASE_TTL_MS,
      });
    }
    return assetLease;
  }

  /**
   * Ensures the notes folder exists before anything tries to list it, so a
   * first run on a machine without `~/Notes` opens an empty panel rather
   * than an error.
   */
  async function ensureRoot(): Promise<string> {
    const notesRoot = await rootDirectory();
    await bb.sdk.files.mkdir({ path: notesRoot, recursive: true });
    return notesRoot;
  }

  async function readSettings(): Promise<{
    settings: NotesSettings;
    overridePath: string | null;
  }> {
    const notesRoot = await rootDirectory();
    const absolute = resolveWithinRoot(notesRoot, SETTINGS_RELATIVE_PATH);
    try {
      const file = await bb.sdk.files.read({
        path: absolute,
        rootPath: notesRoot,
      });
      if (file.contentEncoding !== "utf8") {
        return { settings: IMPORTED_VSCODE_SETTINGS, overridePath: null };
      }
      const override = parseSettings(file.content);
      if (override === null) {
        bb.log.info(
          `ignoring ${SETTINGS_RELATIVE_PATH}: it is not valid JSON or JSONC`,
        );
        return { settings: IMPORTED_VSCODE_SETTINGS, overridePath: null };
      }
      return {
        settings: mergeSettings(IMPORTED_VSCODE_SETTINGS, override),
        overridePath: SETTINGS_RELATIVE_PATH,
      };
    } catch {
      // No override file is the normal case, not a failure.
      return { settings: IMPORTED_VSCODE_SETTINGS, overridePath: null };
    }
  }

  async function listEntries(): Promise<{
    entries: { path: string; kind: "file" | "directory" }[];
    truncated: boolean;
  }> {
    const notesRoot = await ensureRoot();
    const result = await bb.sdk.files.listPaths({
      path: notesRoot,
      includeFiles: true,
      includeDirectories: true,
      includeHidden: false,
      limit: MAX_TREE_ENTRIES,
    });
    return {
      entries: result.paths.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
      })),
      truncated: result.truncated,
    };
  }

  async function readNote(relativePath: string) {
    if (!isMarkdownPath(relativePath)) {
      return {
        kind: "unsupported" as const,
        reason: "Notes only opens Markdown files",
      };
    }
    const notesRoot = await rootDirectory();
    const absolute = resolveWithinRoot(notesRoot, relativePath);
    const file = await bb.sdk.files.read({
      path: absolute,
      rootPath: notesRoot,
    });
    if (file.contentEncoding !== "utf8") {
      return { kind: "unsupported" as const, reason: "This file is not text" };
    }
    if (file.sizeBytes > MAX_EDITABLE_BYTES) {
      return {
        kind: "unsupported" as const,
        reason: `This note is too large to edit (${Math.round(file.sizeBytes / 1024 / 1024)} MB)`,
      };
    }
    return {
      kind: "text" as const,
      content: file.content,
      sha256: file.sha256,
      path: relativeToRoot(notesRoot, absolute),
    };
  }

  async function writeNote(args: {
    path: string;
    content: string;
    expectedSha256: string | null;
  }) {
    if (!isMarkdownPath(args.path)) {
      throw new Error("Notes only writes Markdown files");
    }
    const notesRoot = await rootDirectory();
    const absolute = resolveWithinRoot(notesRoot, args.path);
    const result = await bb.sdk.files.write({
      path: absolute,
      rootPath: notesRoot,
      content: args.content,
      contentEncoding: "utf8",
      createParents: true,
      expectedSha256: args.expectedSha256,
    });
    return result;
  }

  async function createNote(
    relativePath: string,
  ): Promise<{ path: string; sha256: string }> {
    if (!isMarkdownPath(relativePath)) {
      throw new Error("A new note needs a Markdown extension");
    }
    const notesRoot = await rootDirectory();
    const absolute = resolveWithinRoot(notesRoot, relativePath);
    // Writing with `expectedSha256: null` would overwrite an existing note,
    // so an existing path has to become a refusal rather than silent data
    // loss.
    let exists = false;
    try {
      await bb.sdk.files.read({ path: absolute, rootPath: notesRoot });
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) throw new Error("A note with that name already exists");

    const result = await bb.sdk.files.write({
      path: absolute,
      rootPath: notesRoot,
      content: "",
      contentEncoding: "utf8",
      createParents: true,
      expectedSha256: null,
    });
    if (result.outcome !== "written") {
      throw new Error("Could not create that note");
    }
    return {
      path: relativeToRoot(notesRoot, absolute),
      sha256: result.sha256,
    };
  }

  bb.rpc.register(rpcContract, {
    assets: () => assets(),

    async settings() {
      const { settings, overridePath } = await readSettings();
      return { root: await rootDirectory(), settings, overridePath };
    },

    async tree() {
      const { entries, truncated } = await listEntries();
      return { root: await rootDirectory(), entries, truncated };
    },

    read: ({ path: relativePath }) => readNote(relativePath),

    async write(input) {
      const result = await writeNote(input);
      return result.outcome === "written"
        ? { outcome: "written" as const, sha256: result.sha256 }
        : { outcome: "conflict" as const, currentSha256: result.currentSha256 };
    },

    createFile: ({ path: relativePath }) => createNote(relativePath),

    async createDirectory({ path: relativePath }) {
      const notesRoot = await rootDirectory();
      const absolute = resolveWithinRoot(notesRoot, relativePath);
      await bb.sdk.files.mkdir({
        path: absolute,
        rootPath: notesRoot,
        recursive: true,
      });
      return { path: relativeToRoot(notesRoot, absolute) };
    },

    async rename({ from, to }) {
      const notesRoot = await rootDirectory();
      const source = resolveWithinRoot(notesRoot, from);
      const destination = resolveWithinRoot(notesRoot, to);
      await bb.sdk.files.move({
        sourcePath: source,
        destinationPath: destination,
        rootPath: notesRoot,
      });
      return { path: relativeToRoot(notesRoot, destination) };
    },

    async remove({ path: relativePath, recursive }) {
      const notesRoot = await rootDirectory();
      const absolute = resolveWithinRoot(notesRoot, relativePath);
      if (absolute === path.resolve(notesRoot)) {
        throw new Error("The notes folder itself cannot be deleted");
      }
      await bb.sdk.files.remove({
        path: absolute,
        rootPath: notesRoot,
        recursive,
      });
      return { path: relativeToRoot(notesRoot, absolute) };
    },
  });

  bb.cli.register({
    name: "notes",
    summary: "Read and edit the Markdown notes shown in the Notes panel",
    commands: [
      {
        name: "root",
        summary: "Print the notes folder",
        usage: "bb notes root",
      },
      {
        name: "settings",
        summary: "Show the effective editor settings",
        usage: "bb notes settings [--json]",
      },
      {
        name: "list",
        summary: "List notes",
        usage: "bb notes list [--all] [--json]",
      },
      {
        name: "read",
        summary: "Print a note",
        usage: "bb notes read <path>",
      },
      {
        name: "write",
        summary: "Overwrite a note",
        usage: "bb notes write <path> --content <text>",
      },
      {
        name: "new",
        summary: "Create an empty note",
        usage: "bb notes new <path>",
      },
      {
        name: "mkdir",
        summary: "Create a folder",
        usage: "bb notes mkdir <path>",
      },
      {
        name: "move",
        summary: "Rename or move a note or folder",
        usage: "bb notes move <from> <to>",
      },
      {
        name: "remove",
        summary: "Delete a note or folder",
        usage: "bb notes remove <path> [--recursive]",
      },
    ],
    async run(argv: string[], _ctx: PluginCliContext): Promise<PluginCliResult> {
      try {
        const parsed = parseArgs(argv);
        const command = parsed.command;
        const asJson = parsed.flags.get("json") === true;

        if (command === "help" || command === "--help" || command === "-h") {
          return { exitCode: 0, stdout: CLI_USAGE };
        }

        const notesRoot = await rootDirectory();

        if (command === "root") {
          return {
            exitCode: 0,
            stdout: asJson
              ? `${JSON.stringify({ root: notesRoot })}\n`
              : `${notesRoot}\n`,
          };
        }

        if (command === "settings") {
          const { settings, overridePath } = await readSettings();
          if (asJson) {
            return {
              exitCode: 0,
              stdout: `${JSON.stringify({ root: notesRoot, overridePath, settings }, null, 2)}\n`,
            };
          }
          const rules = Object.keys(settings["highlight.regexes"] ?? {}).length;
          return {
            exitCode: 0,
            stdout: [
              `Root:            ${notesRoot}`,
              `Override:        ${overridePath ?? "(none — using imported VS Code defaults)"}`,
              `Highlight rules: ${rules}`,
              `Ordered TOC:     ${settings["markdown.extension.toc.orderedList"] === true ? "yes" : "no"}`,
              "",
            ].join("\n"),
          };
        }

        if (command === "list") {
          const { entries, truncated } = await listEntries();
          const includeAll = parsed.flags.get("all") === true;
          const listed = entries
            .filter(
              (entry) =>
                (entry.kind === "file" && isMarkdownPath(entry.path)) ||
                (includeAll && entry.kind === "directory"),
            )
            .map((entry) => entry.path)
            .sort((left, right) => left.localeCompare(right));
          if (asJson) {
            return {
              exitCode: 0,
              stdout: `${JSON.stringify({ root: notesRoot, truncated, paths: listed }, null, 2)}\n`,
            };
          }
          return {
            exitCode: 0,
            stdout:
              listed.length === 0
                ? "No notes found\n"
                : `${listed.join("\n")}\n${truncated ? "(truncated)\n" : ""}`,
          };
        }

        if (command === "read") {
          const target = requirePositional(parsed, "path");
          const file = await readNote(target);
          if (file.kind !== "text") {
            return { exitCode: 1, stderr: `${file.reason}\n` };
          }
          return {
            exitCode: 0,
            stdout: asJson ? `${JSON.stringify(file, null, 2)}\n` : file.content,
          };
        }

        if (command === "write") {
          const target = requirePositional(parsed, "path");
          const content = flagValue(parsed, "content");
          if (content === undefined) {
            throw new Error("Missing --content.");
          }
          const result = await writeNote({
            path: target,
            content,
            expectedSha256: null,
          });
          if (result.outcome !== "written") {
            return {
              exitCode: 1,
              stderr: "That note changed on disk; re-read it first\n",
            };
          }
          return { exitCode: 0, stdout: `Wrote ${target}\n` };
        }

        if (command === "new") {
          const created = await createNote(requirePositional(parsed, "path"));
          return { exitCode: 0, stdout: `Created ${created.path}\n` };
        }

        if (command === "mkdir") {
          const target = requirePositional(parsed, "path");
          const absolute = resolveWithinRoot(notesRoot, target);
          await bb.sdk.files.mkdir({
            path: absolute,
            rootPath: notesRoot,
            recursive: true,
          });
          return { exitCode: 0, stdout: `Created ${target}\n` };
        }

        if (command === "move") {
          const from = parsed.positionals[0];
          const to = parsed.positionals[1];
          if (from === undefined || to === undefined) {
            throw new Error("Usage: bb notes move <from> <to>");
          }
          await bb.sdk.files.move({
            sourcePath: resolveWithinRoot(notesRoot, from),
            destinationPath: resolveWithinRoot(notesRoot, to),
            rootPath: notesRoot,
          });
          return { exitCode: 0, stdout: `Moved ${from} to ${to}\n` };
        }

        if (command === "remove") {
          const target = requirePositional(parsed, "path");
          const absolute = resolveWithinRoot(notesRoot, target);
          if (absolute === path.resolve(notesRoot)) {
            throw new Error("The notes folder itself cannot be deleted");
          }
          await bb.sdk.files.remove({
            path: absolute,
            rootPath: notesRoot,
            recursive: parsed.flags.get("recursive") === true,
          });
          return { exitCode: 0, stdout: `Removed ${target}\n` };
        }

        throw new Error(`Unknown notes command '${command}'.\n\n${CLI_USAGE}`);
      } catch (error) {
        return {
          exitCode: 1,
          stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        };
      }
    },
  });
}
