import { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { confirmDestructiveAction, outputJson } from "./helpers.js";

interface FileTargetOptions {
  host?: string;
  json?: boolean;
  root?: string;
}

interface FileTarget {
  hostId?: string;
  rootPath?: string;
}

interface FileListOptions extends FileTargetOptions {
  directories?: boolean;
  files?: boolean;
  limit?: string;
  query?: string;
}

interface FileWriteOptions extends FileTargetOptions {
  content?: string;
  createParents?: boolean;
  expectedSha256?: string;
  stdin?: boolean;
}

interface FileRemoveOptions extends FileTargetOptions {
  recursive?: boolean;
  yes?: boolean;
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

function commonTarget(opts: FileTargetOptions) {
  const target: FileTarget = {};
  if (opts.host) target.hostId = opts.host;
  if (opts.root) target.rootPath = opts.root;
  return target;
}

export function registerFileCommands(
  program: Command,
  getUrl: () => string,
): void {
  const file = program
    .command("file")
    .description("Read and manage files on BB machines");

  file
    .command("read <path>")
    .description("Read a file")
    .option("--host <id>", "Machine ID")
    .option("--root <path>", "Confining root path")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: FileTargetOptions) => {
        const result = await createCliBbSdk(getUrl()).files.read({
          path,
          ...commonTarget(opts),
        });
        if (outputJson(opts, result)) return;
        if (result.contentEncoding === "utf8")
          process.stdout.write(result.content);
        else process.stdout.write(`${result.content}\n`);
      }),
    );

  file
    .command("write <path>")
    .description("Write a UTF-8 file")
    .option("--content <text>", "File content")
    .option("--stdin", "Read file content from stdin")
    .option("--host <id>", "Machine ID")
    .option("--root <path>", "Confining root path")
    .option("--create-parents", "Create missing parent directories")
    .option(
      "--expected-sha256 <hash>",
      "Only write when the current hash matches",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: FileWriteOptions) => {
        if ((opts.content === undefined) === (opts.stdin !== true)) {
          throw new Error("Provide exactly one of --content or --stdin.");
        }
        const content = opts.stdin ? await readStdin() : (opts.content ?? "");
        const writeOptions = {
          path,
          content,
          ...commonTarget(opts),
        };
        if (opts.createParents) {
          Object.assign(writeOptions, { createParents: true });
        }
        if (opts.expectedSha256) {
          Object.assign(writeOptions, { expectedSha256: opts.expectedSha256 });
        }
        const result = await createCliBbSdk(getUrl()).files.write(writeOptions);
        if (outputJson(opts, result)) return;
        console.log(
          result.outcome === "written"
            ? `Wrote ${path}`
            : `Write conflict for ${path}`,
        );
      }),
    );

  file
    .command("list <path>")
    .description("Recursively list files")
    .option("--query <query>", "Fuzzy path query")
    .option("--limit <count>", "Maximum entries")
    .option("--host <id>", "Machine ID")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: FileListOptions) => {
        const listOptions = { path };
        if (opts.host) Object.assign(listOptions, { hostId: opts.host });
        if (opts.query) Object.assign(listOptions, { query: opts.query });
        const limit = parseLimit(opts.limit);
        if (limit) Object.assign(listOptions, { limit });
        const result = await createCliBbSdk(getUrl()).files.list(listOptions);
        if (outputJson(opts, result)) return;
        for (const entry of result.files) console.log(entry.path);
      }),
    );

  file
    .command("paths <path>")
    .description("List matching files and directories")
    .option("--query <query>", "Fuzzy path query")
    .option("--limit <count>", "Maximum entries")
    .option("--files", "Include files")
    .option("--directories", "Include directories")
    .option("--host <id>", "Machine ID")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: FileListOptions) => {
        const includeFiles = opts.files || !opts.directories;
        const includeDirectories = opts.directories || !opts.files;
        const limit = parseLimit(opts.limit);
        const pathsOptions = {
          path,
          includeFiles,
          includeDirectories,
        };
        if (opts.host) Object.assign(pathsOptions, { hostId: opts.host });
        if (opts.query) Object.assign(pathsOptions, { query: opts.query });
        if (limit) Object.assign(pathsOptions, { limit });
        const result =
          await createCliBbSdk(getUrl()).files.listPaths(pathsOptions);
        if (outputJson(opts, result)) return;
        for (const entry of result.paths)
          console.log(`${entry.kind}\t${entry.path}`);
      }),
    );

  file
    .command("mkdir <path>")
    .description("Create a directory")
    .option("--recursive", "Create missing parent directories")
    .option("--host <id>", "Machine ID")
    .option("--root <path>", "Confining root path")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          path: string,
          opts: FileTargetOptions & { recursive?: boolean },
        ) => {
          const result = await createCliBbSdk(getUrl()).files.mkdir({
            path,
            ...commonTarget(opts),
            recursive: opts.recursive,
          });
          if (outputJson(opts, result)) return;
          console.log(`Created directory ${path}`);
        },
      ),
    );

  file
    .command("move <source> <destination>")
    .description("Move a file or directory")
    .option("--host <id>", "Machine ID")
    .option("--root <path>", "Confining root path")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          source: string,
          destination: string,
          opts: FileTargetOptions,
        ) => {
          const result = await createCliBbSdk(getUrl()).files.move({
            sourcePath: source,
            destinationPath: destination,
            ...commonTarget(opts),
          });
          if (outputJson(opts, result)) return;
          console.log(`Moved ${source} to ${destination}`);
        },
      ),
    );

  file
    .command("remove <path>")
    .description("Remove a file or directory")
    .option("--recursive", "Remove a directory recursively")
    .option("--yes", "Skip the confirmation prompt")
    .option("--host <id>", "Machine ID")
    .option("--root <path>", "Confining root path")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (path: string, opts: FileRemoveOptions) => {
        if (!opts.yes && !(await confirmDestructiveAction(`Remove ${path}?`)))
          return;
        const result = await createCliBbSdk(getUrl()).files.remove({
          path,
          ...commonTarget(opts),
          recursive: opts.recursive,
        });
        if (outputJson(opts, result)) return;
        console.log(`Removed ${path}`);
      }),
    );
}
