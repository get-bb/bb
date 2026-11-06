import type { Command } from "commander";
import { YES_FLAG_DESCRIPTION, arg, flag } from "../cli-door.js";
import { mountCommands, publicCommand } from "../operation-doors.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  return parsed;
}

function listArgs(options: {
  hidden: boolean;
  exclude: string[];
  hostId: string | undefined;
  query: string | undefined;
  limit: string | undefined;
}): {
  includeHidden?: boolean;
  excludeNames?: string[];
  hostId?: string;
  query?: string;
  limit?: number;
} {
  const limit = parseLimit(options.limit);
  return {
    ...(options.hidden ? {} : { includeHidden: false }),
    ...(options.exclude.length > 0 ? { excludeNames: options.exclude } : {}),
    ...(options.hostId ? { hostId: options.hostId } : {}),
    ...(options.query ? { query: options.query } : {}),
    ...(limit ? { limit } : {}),
  };
}

const HOST_OPTION = flag("--host <id>", "Machine ID");
const ROOT_OPTION = flag("--root <path>", "Confining root path");
const QUERY_OPTION = flag("--query <query>", "Fuzzy path query");
const LIMIT_OPTION = flag("--limit <count>", "Maximum entries");
const NO_HIDDEN_OPTION = flag(
  "--no-hidden",
  "Skip dot-prefixed files and directories",
);
const EXCLUDE_OPTION = flag(
  "--exclude <names...>",
  "Entry names or root-relative paths (using /) to skip instead of the default set",
  { type: "strings" },
);
const TARGET_OPTIONS = { hostId: HOST_OPTION, rootPath: ROOT_OPTION };
const PATH_POSITIONAL = { path: arg("<path>") };

export const fileCommands = [
  publicCommand("files.read", {
    path: ["file", "read"],
    summary: "Read a file",
    positionals: PATH_POSITIONAL,
    options: TARGET_OPTIONS,
    print: (result) => {
      if (result.contentEncoding === "utf8")
        process.stdout.write(result.content);
      else process.stdout.write(`${result.content}\n`);
      return null;
    },
  }),
  publicCommand("files.write", {
    path: ["file", "write"],
    summary: "Write a UTF-8 file",
    positionals: PATH_POSITIONAL,
    options: {
      content: flag("--content <text>", "File content"),
      stdin: flag("--stdin", "Read file content from stdin"),
      ...TARGET_OPTIONS,
      createParents: flag(
        "--create-parents",
        "Create missing parent directories",
      ),
      expectedSha256: flag(
        "--expected-sha256 <hash>",
        "Only write when the current hash matches",
      ),
    },
    prepare: async ({ positionals, options }) => {
      const { content, stdin, hostId, rootPath, expectedSha256 } = options;
      if ((content === undefined) === !stdin) {
        throw new Error("Provide exactly one of --content or --stdin.");
      }
      return {
        path: positionals.path,
        content: stdin ? await readStdin() : (content ?? ""),
        ...(hostId ? { hostId } : {}),
        ...(rootPath ? { rootPath } : {}),
        ...(options.createParents ? { createParents: true } : {}),
        ...(expectedSha256 ? { expectedSha256 } : {}),
      };
    },
    print: (result, input) =>
      result.outcome === "written"
        ? `Wrote ${input.path}`
        : `Write conflict for ${input.path}`,
  }),
  publicCommand("files.list", {
    path: ["file", "list"],
    summary: "Recursively list files",
    positionals: PATH_POSITIONAL,
    options: {
      query: QUERY_OPTION,
      limit: LIMIT_OPTION,
      hidden: NO_HIDDEN_OPTION,
      exclude: EXCLUDE_OPTION,
      hostId: HOST_OPTION,
    },
    prepare: ({ positionals, options }) => ({
      path: positionals.path,
      ...listArgs(options),
    }),
    print: (result) => result.files.map((entry) => entry.path),
  }),
  publicCommand("files.listPaths", {
    path: ["file", "paths"],
    summary: "List matching files and directories",
    positionals: PATH_POSITIONAL,
    options: {
      query: QUERY_OPTION,
      limit: LIMIT_OPTION,
      files: flag("--files", "Include files"),
      directories: flag("--directories", "Include directories"),
      hidden: NO_HIDDEN_OPTION,
      exclude: EXCLUDE_OPTION,
      hostId: HOST_OPTION,
    },
    prepare: ({ positionals, options }) => ({
      path: positionals.path,
      includeFiles: options.files || !options.directories,
      includeDirectories: options.directories || !options.files,
      ...listArgs(options),
    }),
    print: (result) =>
      result.paths.map((entry) => `${entry.kind}\t${entry.path}`),
  }),
  publicCommand("files.mkdir", {
    path: ["file", "mkdir"],
    summary: "Create a directory",
    positionals: PATH_POSITIONAL,
    options: {
      recursive: flag("--recursive", "Create missing parent directories"),
      ...TARGET_OPTIONS,
    },
    print: (_result, input) => `Created directory ${input.path}`,
  }),
  publicCommand("files.move", {
    path: ["file", "move"],
    summary: "Move a file or directory",
    positionals: {
      sourcePath: arg("<source>"),
      destinationPath: arg("<destination>"),
    },
    options: TARGET_OPTIONS,
    print: (_result, input) =>
      `Moved ${input.sourcePath} to ${input.destinationPath}`,
  }),
  publicCommand("files.remove", {
    path: ["file", "remove"],
    summary: "Remove a file or directory",
    positionals: PATH_POSITIONAL,
    options: {
      recursive: flag("--recursive", "Remove a directory recursively"),
      yes: flag("--yes", YES_FLAG_DESCRIPTION),
      ...TARGET_OPTIONS,
    },
    confirm: (input) => `Remove ${input.path}?`,
    print: (_result, input) => `Removed ${input.path}`,
  }),
];

export function registerFileCommands(
  program: Command,
  getUrl: () => string,
): void {
  program.command("file").description("Read and manage files on BB machines");
  mountCommands(program, fileCommands, { getUrl });
}
