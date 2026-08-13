import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, link, lstat, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { PluginCliContext, PluginCliResult } from "@bb/plugin-sdk";

import { RemoteError } from "../../../lib/remote/types.js";
import {
  createSbomExport,
  SbomExportError,
  type ExportDeps,
  type SbomExportArtifact,
  type SbomExportFormat,
} from "./export.js";

export interface SbomExportCliDeps extends ExportDeps {
  /** Verified host boundary supplied by WP-64's command-tree composition. */
  permittedOutputRoot: string;
  createId?: () => string;
}

interface CliOptions {
  projectVersionId: string;
  format: SbomExportFormat;
  includeVex: boolean;
  output: string | null;
  json: boolean;
}

class SbomExportCliError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SbomExportCliError";
    this.code = code;
  }
}

function optionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new SbomExportCliError("SBOM_CLI_USAGE", `${option} requires a value.`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  let projectVersionId: string | null = null;
  let format: SbomExportFormat | null = null;
  let includeVex = true;
  let includeVexOption: "include" | "exclude" | null = null;
  let output: string | null = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--version") {
      if (projectVersionId !== null) throw new SbomExportCliError("SBOM_CLI_USAGE", "--version may be provided only once.");
      projectVersionId = optionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--format") {
      if (format !== null) throw new SbomExportCliError("SBOM_CLI_USAGE", "--format may be provided only once.");
      const value = optionValue(argv, index, arg);
      if (value !== "cyclonedx" && value !== "spdx") {
        throw new SbomExportCliError("SBOM_CLI_USAGE", "--format must be cyclonedx or spdx.");
      }
      format = value === "cyclonedx" ? "cyclonedx-json" : "spdx";
      index += 1;
    } else if (arg === "-o" || arg === "--output") {
      if (output !== null) throw new SbomExportCliError("SBOM_CLI_USAGE", "An output path may be provided only once.");
      output = optionValue(argv, index, arg);
      index += 1;
    } else if (arg === "--include-vex" || arg === "--no-include-vex") {
      const next = arg === "--include-vex" ? "include" : "exclude";
      if (includeVexOption !== null && includeVexOption !== next) {
        throw new SbomExportCliError("SBOM_CLI_USAGE", "--include-vex and --no-include-vex cannot be combined.");
      }
      includeVexOption = next;
      includeVex = next === "include";
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new SbomExportCliError("SBOM_CLI_USAGE", `Unknown option: ${arg}`);
    }
  }

  if (projectVersionId === null) throw new SbomExportCliError("SBOM_CLI_USAGE", "--version is required.");
  if (format === null) throw new SbomExportCliError("SBOM_CLI_USAGE", "--format is required.");
  if (output === null && !json) {
    throw new SbomExportCliError(
      "SBOM_OUTPUT_REQUIRED",
      "Binary SBOM output is not written to the terminal. Provide a destination with -o <file>, or use --json for metadata only.",
    );
  }
  return { projectVersionId, format, includeVex, output, json };
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

async function resolveOutputPath(
  rootInput: string,
  cwd: string | undefined,
  output: string,
): Promise<string> {
  const root = await realpath(rootInput);
  const base = cwd === undefined ? root : await realpath(cwd);
  const unresolved = resolve(base, output);
  const parent = await realpath(dirname(unresolved)).catch(() => {
    throw new SbomExportCliError(
      "SBOM_OUTPUT_PARENT_INVALID",
      "The output directory must already exist inside the permitted output boundary.",
    );
  });
  const candidate = resolve(parent, basename(unresolved));
  if (candidate === root || !isWithin(root, candidate)) {
    throw new SbomExportCliError(
      "SBOM_OUTPUT_OUTSIDE_BOUNDARY",
      "The output file must be inside the permitted output boundary.",
    );
  }
  if (!isWithin(root, parent) && parent !== root) {
    throw new SbomExportCliError(
      "SBOM_OUTPUT_OUTSIDE_BOUNDARY",
      "The output file must be inside the permitted output boundary.",
    );
  }
  await access(parent, constants.W_OK).catch(() => {
    throw new SbomExportCliError(
      "SBOM_OUTPUT_NOT_WRITABLE",
      "The output directory is not writable.",
    );
  });
  try {
    await lstat(candidate);
    throw new SbomExportCliError(
      "SBOM_OUTPUT_EXISTS",
      "The output file already exists; choose a new path.",
    );
  } catch (error: unknown) {
    if (error instanceof SbomExportCliError) throw error;
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return candidate;
}

async function writeChunk(
  file: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const result = await file.write(chunk, offset, chunk.byteLength - offset);
    if (result.bytesWritten === 0) {
      throw new SbomExportCliError("SBOM_OUTPUT_WRITE_FAILED", "The output file could not be written.");
    }
    offset += result.bytesWritten;
  }
}

async function writeAtomically(
  artifact: SbomExportArtifact,
  destination: string,
  createId: () => string,
): Promise<void> {
  const partial = resolve(dirname(destination), `.${basename(destination)}.bb-fs-${createId()}.part`);
  let file: Awaited<ReturnType<typeof open>> | null = null;
  try {
    file = await open(partial, "wx", 0o600);
    for await (const chunk of artifact.stream) {
      if (!(chunk instanceof Uint8Array)) {
        throw new SbomExportCliError("SBOM_EXPORT_INVALID_CHUNK", "The Platform export stream was invalid.");
      }
      await writeChunk(file, chunk);
    }
    await file.sync();
    await file.close();
    file = null;
    await link(partial, destination).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        throw new SbomExportCliError(
          "SBOM_OUTPUT_EXISTS",
          "The output file already exists; choose a new path.",
        );
      }
      throw error;
    });
    await unlink(partial);
  } catch (error: unknown) {
    await file?.close().catch(() => undefined);
    await unlink(partial).catch(() => undefined);
    throw error;
  }
}

function safeCliError(error: unknown): PluginCliResult {
  if (error instanceof SbomExportCliError || error instanceof SbomExportError) {
    return { exitCode: 2, stderr: `${error.code}: ${error.message}\n` };
  }
  if (error instanceof RemoteError && error.code === "REMOTE_RATE_LIMITED") {
    const delay = error.retryAfterMs === null
      ? "after the Platform rate limit resets"
      : `in ${Math.max(1, Math.ceil(error.retryAfterMs / 1_000))} seconds`;
    return {
      exitCode: 1,
      stderr: `REMOTE_RATE_LIMITED: The Platform export limit was reached. Retry ${delay}; no output file was created.\n`,
    };
  }
  if (error instanceof RemoteError && error.code === "REMOTE_ABORTED") {
    return { exitCode: 1, stderr: "SBOM_EXPORT_CANCELLED: Export cancelled; no partial output was kept.\n" };
  }
  return {
    exitCode: 1,
    stderr: "SBOM_EXPORT_FAILED: The Platform export failed; no partial output was kept.\n",
  };
}

export async function handleSbomExportCli(
  deps: SbomExportCliDeps,
  argv: string[],
  context: PluginCliContext = {},
): Promise<PluginCliResult> {
  let artifact: SbomExportArtifact | null = null;
  const ownedAbort = new AbortController();
  const signal = context.signal === undefined
    ? ownedAbort.signal
    : AbortSignal.any([context.signal, ownedAbort.signal]);
  try {
    const options = parseArgs(argv);
    const destination = options.output === null
      ? null
      : await resolveOutputPath(deps.permittedOutputRoot, context.cwd, options.output);
    artifact = await createSbomExport(
      deps,
      {
        projectVersionId: options.projectVersionId,
        format: options.format,
        includeVex: options.includeVex,
      },
      signal,
    );
    if (destination !== null) {
      await writeAtomically(artifact, destination, deps.createId ?? randomUUID);
    }
    const metadata = {
      filename: artifact.filename,
      contentType: artifact.contentType,
      bytes: artifact.bytes,
      format: options.format,
      includeVex: options.includeVex,
      written: destination !== null,
    };
    return options.json
      ? { exitCode: 0, stdout: `${JSON.stringify(metadata)}\n` }
      : { exitCode: 0, stdout: `Exported ${metadata.filename}.\n` };
  } catch (error: unknown) {
    return safeCliError(error);
  } finally {
    ownedAbort.abort();
    await artifact?.dispose().catch(() => undefined);
  }
}
