import path from "node:path";
import { Command } from "commander";
import {
  threadOpenSplitSchema,
  type PanelFileSource,
  type ThreadOpenFile,
} from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  resolveContextThreadId,
  resolveExplicitIdFlag,
} from "../../context-env.js";
import { outputJson, printContextLabel, type ResolvedId } from "../helpers.js";

interface ThreadOpenCommandOptions {
  debugHidden?: boolean;
  line?: string;
  json?: boolean;
  split?: string;
}

interface ThreadOpenTarget {
  threadId: string;
  inputPath: string | null;
  resolved: ResolvedId;
}

interface ThreadOpenFileRequest {
  source: PanelFileSource;
  path: string;
}

type CliBbSdk = ReturnType<typeof createCliBbSdk>;

export function registerOpenCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("open")
    .description("Open a BB thread, optionally with a file in its panel")
    .usage("[id] [path] [options]")
    .argument("[id]", "Thread ID. Omit inside a BB thread.")
    .argument("[path]", "Thread-relative or absolute file path to open")
    .option("--debug-hidden", "Explicitly open a hidden thread for debugging")
    .option("--line <number>", "Line number to focus")
    .option(
      "--split <placement>",
      "Open in right, down, left, top, or replace placement (requires the Thread splits experiment)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          first: string | undefined,
          second: string | undefined,
          opts: ThreadOpenCommandOptions,
        ) => {
          const target = resolveThreadOpenTarget(
            first,
            second,
            opts.split !== undefined || opts.debugHidden === true,
          );
          const lineNumber = parseLineNumber(opts.line);
          const requestedSplit =
            opts.split === undefined
              ? undefined
              : threadOpenSplitSchema.parse(opts.split);
          const split = requestedSplit ?? "replace";
          if (target.inputPath === null && lineNumber !== null) {
            throw new Error("--line requires a file path.");
          }
          const sdk = createCliBbSdk(getUrl());
          const file: ThreadOpenFile | null =
            target.inputPath === null
              ? null
              : {
                  ...(await resolveThreadOpenFileRequest({
                    inputPath: target.inputPath,
                    sdk,
                    threadId: target.threadId,
                  })),
                  lineNumber,
                };
          const result = await sdk.threads.open({
            ...(opts.debugHidden === true ? { debugHidden: true } : {}),
            threadId: target.threadId,
            ...(requestedSplit === undefined ? {} : { split: requestedSplit }),
            file,
          });

          if (
            outputJson(opts, {
              threadId: target.threadId,
              split,
              file,
              delivered: result.delivered,
              inputPath: target.inputPath,
            })
          ) {
            return;
          }

          printContextLabel(target.resolved, "Thread", "BB_THREAD_ID", opts);
          console.log(`Thread: ${target.threadId}`);
          console.log(`Split: ${split}`);
          if (file !== null) {
            console.log(`Source: ${file.source}`);
            console.log(`Path: ${file.path}`);
            if (file.lineNumber !== null) {
              console.log(`Line: ${file.lineNumber}`);
            }
          }
          console.log(`Delivered: ${result.delivered}`);
        },
      ),
    );
}

function resolveThreadOpenTarget(
  first: string | undefined,
  second: string | undefined,
  allowsExplicitThreadTarget: boolean,
): ThreadOpenTarget {
  const contextThreadId = resolveContextThreadId();
  if (contextThreadId) {
    if (first === undefined) {
      return {
        threadId: contextThreadId,
        inputPath: null,
        resolved: { id: contextThreadId, source: "env" },
      };
    }

    if (second !== undefined) {
      const explicitThreadId = resolveExplicitIdFlag({
        flagName: "<threadId> argument",
        value: first,
      });
      if (!explicitThreadId) {
        throw new Error("Missing thread ID. Pass <threadId>.");
      }
      if (explicitThreadId !== contextThreadId && !allowsExplicitThreadTarget) {
        throw new Error(
          "BB_THREAD_ID is set, so bb thread open targets the current thread. Omit the thread ID.",
        );
      }
      return {
        threadId: allowsExplicitThreadTarget
          ? explicitThreadId
          : contextThreadId,
        inputPath: second,
        resolved: allowsExplicitThreadTarget
          ? { id: explicitThreadId, source: "arg" }
          : { id: contextThreadId, source: "env" },
      };
    }

    if (allowsExplicitThreadTarget) {
      const threadId = resolveExplicitIdFlag({
        flagName: "<threadId> argument",
        value: first,
      });
      if (!threadId) {
        throw new Error("Missing thread ID. Pass <threadId>.");
      }
      return {
        threadId,
        inputPath: null,
        resolved: { id: threadId, source: "arg" },
      };
    }

    return {
      threadId: contextThreadId,
      inputPath: first,
      resolved: { id: contextThreadId, source: "env" },
    };
  }

  if (first === undefined) {
    throw new Error(
      "Missing thread ID. Pass <threadId> [path], or run inside a BB thread.",
    );
  }

  const threadId = resolveExplicitIdFlag({
    flagName: "<threadId> argument",
    value: first,
  });
  if (!threadId) {
    throw new Error("Missing thread ID. Pass <threadId>.");
  }
  return {
    threadId,
    inputPath: second ?? null,
    resolved: { id: threadId, source: "arg" },
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
  sdk: CliBbSdk;
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
    args.sdk,
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
  sdk: CliBbSdk,
  threadId: string,
): Promise<string> {
  const thread = await sdk.threads.get({ threadId });
  if (thread.environmentId === null) {
    throw new Error(`Thread ${threadId} does not have an attached workspace.`);
  }
  const environment = await sdk.environments.get({
    environmentId: thread.environmentId,
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
