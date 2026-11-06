import type { Command } from "commander";
import { YES_FLAG_DESCRIPTION, type CliValues, flag } from "@bb/operations";
import { mountCommands, publicCommand } from "../operation-doors.js";

type Options = CliValues["options"];

function text(options: Options, flag: string): string | undefined {
  const value = options[flag];
  return typeof value === "string" ? value : undefined;
}

function positional(values: CliValues, name: string): string {
  const value = values.positionals[name];
  return typeof value === "string" ? value : "";
}

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

function commonTarget(options: Options) {
  const host = text(options, "host");
  const root = text(options, "root");
  return {
    ...(host ? { hostId: host } : {}),
    ...(root ? { rootPath: root } : {}),
  };
}

function listFilterArgs(options: Options): {
  includeHidden?: boolean;
  excludeNames?: string[];
} {
  const exclude = options.exclude;
  return {
    ...(options.hidden === false ? { includeHidden: false } : {}),
    ...(Array.isArray(exclude) ? { excludeNames: exclude } : {}),
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
);
const PATH_POSITIONAL = [{ name: "path" }] as const;

export const fileCommands = [
  publicCommand("files.read", {
    path: ["file", "read"],
    summary: "Read a file",
    positionals: PATH_POSITIONAL,
    options: [HOST_OPTION, ROOT_OPTION],
    prepare: (values) => ({
      path: positional(values, "path"),
      ...commonTarget(values.options),
    }),
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
    options: [
      flag("--content <text>", "File content"),
      flag("--stdin", "Read file content from stdin"),
      HOST_OPTION,
      ROOT_OPTION,
      flag("--create-parents", "Create missing parent directories"),
      flag(
        "--expected-sha256 <hash>",
        "Only write when the current hash matches",
      ),
    ],
    prepare: async (values) => {
      const { options } = values;
      const content = text(options, "content");
      const stdin = options.stdin === true;
      if ((content === undefined) === !stdin) {
        throw new Error("Provide exactly one of --content or --stdin.");
      }
      const expectedSha256 = text(options, "expected-sha256");
      return {
        path: positional(values, "path"),
        content: stdin ? await readStdin() : (content ?? ""),
        ...commonTarget(options),
        ...(options["create-parents"] === true ? { createParents: true } : {}),
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
    options: [
      QUERY_OPTION,
      LIMIT_OPTION,
      NO_HIDDEN_OPTION,
      EXCLUDE_OPTION,
      HOST_OPTION,
    ],
    prepare: (values) => {
      const { options } = values;
      const host = text(options, "host");
      const query = text(options, "query");
      const limit = parseLimit(text(options, "limit"));
      return {
        path: positional(values, "path"),
        ...listFilterArgs(options),
        ...(host ? { hostId: host } : {}),
        ...(query ? { query } : {}),
        ...(limit ? { limit } : {}),
      };
    },
    print: (result) => result.files.map((entry) => entry.path),
  }),
  publicCommand("files.listPaths", {
    path: ["file", "paths"],
    summary: "List matching files and directories",
    positionals: PATH_POSITIONAL,
    options: [
      QUERY_OPTION,
      LIMIT_OPTION,
      flag("--files", "Include files"),
      flag("--directories", "Include directories"),
      NO_HIDDEN_OPTION,
      EXCLUDE_OPTION,
      HOST_OPTION,
    ],
    prepare: (values) => {
      const { options } = values;
      const files = options.files === true;
      const directories = options.directories === true;
      const host = text(options, "host");
      const query = text(options, "query");
      const limit = parseLimit(text(options, "limit"));
      return {
        path: positional(values, "path"),
        includeFiles: files || !directories,
        includeDirectories: directories || !files,
        ...listFilterArgs(options),
        ...(host ? { hostId: host } : {}),
        ...(query ? { query } : {}),
        ...(limit ? { limit } : {}),
      };
    },
    print: (result) =>
      result.paths.map((entry) => `${entry.kind}\t${entry.path}`),
  }),
  publicCommand("files.mkdir", {
    path: ["file", "mkdir"],
    summary: "Create a directory",
    positionals: PATH_POSITIONAL,
    options: [
      flag("--recursive", "Create missing parent directories"),
      HOST_OPTION,
      ROOT_OPTION,
    ],
    prepare: (values) => ({
      path: positional(values, "path"),
      ...commonTarget(values.options),
      ...(values.options.recursive === true ? { recursive: true } : {}),
    }),
    print: (_result, input) => `Created directory ${input.path}`,
  }),
  publicCommand("files.move", {
    path: ["file", "move"],
    summary: "Move a file or directory",
    positionals: [{ name: "source" }, { name: "destination" }],
    options: [HOST_OPTION, ROOT_OPTION],
    prepare: (values) => ({
      sourcePath: positional(values, "source"),
      destinationPath: positional(values, "destination"),
      ...commonTarget(values.options),
    }),
    print: (_result, input) =>
      `Moved ${input.sourcePath} to ${input.destinationPath}`,
  }),
  publicCommand("files.remove", {
    path: ["file", "remove"],
    summary: "Remove a file or directory",
    positionals: PATH_POSITIONAL,
    options: [
      flag("--recursive", "Remove a directory recursively"),
      flag("--yes", YES_FLAG_DESCRIPTION),
      HOST_OPTION,
      ROOT_OPTION,
    ],
    confirm: (input) => `Remove ${input.path}?`,
    prepare: (values) => ({
      path: positional(values, "path"),
      ...commonTarget(values.options),
      ...(values.options.recursive === true ? { recursive: true } : {}),
    }),
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
