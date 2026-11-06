import { flag } from "@bb/operations";
import path from "node:path";
import type { Command } from "commander";
import { isRawThreadId } from "@bb/domain";
import {
  threadOpenSplitSchema,
  type PanelFileSource,
  type ThreadOpenFile,
  type ThreadOpenSplit,
} from "@bb/server-contract";
import {
  clientCommand,
  mountCommand,
  type CliClient,
} from "../../operation-doors.js";
import { requireThreadId, resolveContextThreadId } from "../../context-env.js";
import { printThreadContextLabel, type ResolvedId } from "../helpers.js";

interface ThreadOpenTarget {
  threadId: string;
  inputPath: string | null;
  resolved: ResolvedId;
}

interface ThreadOpenFileRequest {
  source: PanelFileSource;
  path: string;
}

interface ThreadOpenInput {
  target: ThreadOpenTarget;
  lineNumber: number | null;
  requestedSplit: ThreadOpenSplit | undefined;
}

interface ThreadOpenOutput {
  target: ThreadOpenTarget;
  split: ThreadOpenSplit;
  file: ThreadOpenFile | null;
  delivered: number;
}

export const threadOpenCommand = clientCommand<
  ThreadOpenInput,
  ThreadOpenOutput
>({
  name: "cli.thread.open",
  kind: "write",
  description:
    "Resolve the thread and file (reading threads.get and environments.get for absolute paths), then run threads.open",
  door: {
    path: ["thread", "open"],
    summary: "Open a BB thread, optionally with a file in its panel",
    usage: "[id] [path] [options]",
    positionals: [
      {
        name: "id",
        required: false,
        description:
          "Thread ID. Inside a BB thread, omit it to target the current thread; a lone argument that is not a thread ID opens that file in the current thread",
      },
      {
        name: "path",
        required: false,
        description: "Thread-relative or absolute file path to open",
      },
    ],
    options: [
      flag("--line <number>", "Line number to focus"),
      flag(
        "--split <placement>",
        "Open in right, down, left, top, or replace placement; edge placements add panes through pane 8, then replace the focused pane",
      ),
    ],
    prepare: ({ positionals, options }) => {
      const first = positionals.id;
      const second = positionals.path;
      const target = resolveThreadOpenTarget(
        typeof first === "string" ? first : undefined,
        typeof second === "string" ? second : undefined,
      );
      const lineNumber = parseLineNumber(
        typeof options.line === "string" ? options.line : undefined,
      );
      const requestedSplit =
        options.split === undefined
          ? undefined
          : threadOpenSplitSchema.parse(options.split);
      if (target.inputPath === null && lineNumber !== null) {
        throw new Error("--line requires a file path.");
      }
      return { target, lineNumber, requestedSplit };
    },
    run: async ({ target, lineNumber, requestedSplit }, client) => {
      const file: ThreadOpenFile | null =
        target.inputPath === null
          ? null
          : {
              ...(await resolveThreadOpenFileRequest({
                inputPath: target.inputPath,
                client,
                threadId: target.threadId,
              })),
              lineNumber,
            };
      const result = await client.call("threads.open", {
        id: target.threadId,
        ...(requestedSplit === undefined ? {} : { split: requestedSplit }),
        file,
      });
      return {
        target,
        split: requestedSplit ?? "replace",
        file,
        delivered: result.delivered,
      };
    },
    json: ({ target, split, file, delivered }) => ({
      threadId: target.threadId,
      split,
      file,
      delivered,
      inputPath: target.inputPath,
    }),
    print: ({ target, split, file, delivered }) => {
      printThreadContextLabel(target.resolved);
      const lines = [`Thread: ${target.threadId}`, `Split: ${split}`];
      if (file !== null) {
        lines.push(`Source: ${file.source}`, `Path: ${file.path}`);
        if (file.lineNumber !== null) lines.push(`Line: ${file.lineNumber}`);
      }
      lines.push(`Delivered: ${delivered}`);
      return lines;
    },
  },
});

export function registerOpenCommand(
  parent: Command,
  getUrl: () => string,
): void {
  mountCommand(parent, threadOpenCommand, { getUrl });
}

function resolveThreadOpenTarget(
  first: string | undefined,
  second: string | undefined,
): ThreadOpenTarget {
  const contextThreadId = resolveContextThreadId();
  if (
    first !== undefined &&
    (second !== undefined || !contextThreadId || isRawThreadId(first))
  ) {
    const threadId = requireThreadId(first);
    return {
      threadId,
      inputPath: second ?? null,
      resolved: { id: threadId, source: "arg" },
    };
  }

  if (!contextThreadId) {
    throw new Error(
      "Missing thread ID. Pass <threadId> [path], or run inside a BB thread.",
    );
  }
  return {
    threadId: contextThreadId,
    inputPath: first ?? null,
    resolved: { id: contextThreadId, source: "env" },
  };
}

function parseLineNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("Invalid --line value. Pass a positive integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid --line value. Pass a positive integer.");
  }
  return parsed;
}

async function resolveThreadOpenFileRequest(args: {
  inputPath: string;
  client: CliClient;
  threadId: string;
}): Promise<ThreadOpenFileRequest> {
  const inputPath = args.inputPath.trim();
  if (inputPath.length === 0) {
    throw new Error("Missing path. Pass <path>.");
  }

  if (!path.isAbsolute(inputPath)) {
    return {
      source: "workspace",
      path: normalizePanelRelativePath(inputPath),
    };
  }

  const absoluteInputPath = path.resolve(inputPath);
  const threadStorageRoot = resolveThreadStorageRoot(args.threadId);
  if (threadStorageRoot && pathContains(threadStorageRoot, absoluteInputPath)) {
    return {
      source: "thread-storage",
      path: normalizePanelRelativePath(
        toPanelRelativePath(threadStorageRoot, absoluteInputPath),
      ),
    };
  }

  const workspaceRoot = await resolveThreadWorkspaceRoot(
    args.client,
    args.threadId,
  );
  if (pathContains(workspaceRoot, absoluteInputPath)) {
    return {
      source: "workspace",
      path: normalizePanelRelativePath(
        toPanelRelativePath(workspaceRoot, absoluteInputPath),
      ),
    };
  }

  const acceptedRoots = threadStorageRoot
    ? "the target thread workspace or BB_THREAD_STORAGE"
    : "the target thread workspace";
  throw new Error(`Absolute path must be inside ${acceptedRoots}.`);
}

async function resolveThreadWorkspaceRoot(
  client: CliClient,
  threadId: string,
): Promise<string> {
  const thread = await client.call("threads.get", { id: threadId });
  if (thread.environmentId === null) {
    throw new Error(`Thread ${threadId} does not have an attached workspace.`);
  }
  const environment = await client.call("environments.get", {
    id: thread.environmentId,
  });
  if (environment.path === null) {
    throw new Error(`Thread ${threadId} does not have a local workspace path.`);
  }
  return path.resolve(environment.path);
}

function resolveThreadStorageRoot(threadId: string): string | undefined {
  if (resolveContextThreadId() !== threadId) return undefined;
  const rawRoot = process.env.BB_THREAD_STORAGE?.trim();
  if (!rawRoot) return undefined;
  return path.resolve(rawRoot);
}

function pathContains(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function toPanelRelativePath(root: string, target: string): string {
  return path
    .relative(path.resolve(root), path.resolve(target))
    .split(path.sep)
    .join("/");
}

function normalizePanelRelativePath(inputPath: string): string {
  const normalized = path.normalize(inputPath).split(path.sep).join("/");
  if (normalized.includes("\\") || path.posix.isAbsolute(normalized)) {
    throw new Error(
      "Open path must be a relative file path without absolute path syntax.",
    );
  }

  const segments = normalized.split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      "Open path must be a relative file path without . or .. segments.",
    );
  }

  return segments.join("/");
}
