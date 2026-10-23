import { z } from "zod";
import {
  jsonValueSchema,
  type JsonValue,
  BRANCH_LIST_LIMIT_MAX,
  workspaceDiffTargetSchema,
  type WorkspaceDiffTarget,
  GIT_PLUGIN_ID,
} from "@bb/domain";
import { BbHttpError } from "../response.js";
import type { PluginsArea } from "./plugins.js";


type DiffTargetArgs =
  | { target: "uncommitted" }
  | { target: "branch_committed" | "all"; mergeBaseBranch: string }
  | { target: "commit"; sha: string };

type EnvironmentReadArgs = { environmentId: string; signal?: AbortSignal };

type RetiredDiffFileArgs = EnvironmentReadArgs & { path: string; side: "old" | "new" } & (
    | { target: "uncommitted" }
    | { target: "branch_committed" | "all"; mergeBaseRef: string }
    | { target: "commit"; sha: string }
  );

const recordSchema = z.record(z.string(), jsonValueSchema);
const patchRowSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("available"), patch: jsonValueSchema }),
  z.object({ outcome: z.literal("not_applicable") }).passthrough(),
  z.object({ outcome: z.literal("unavailable") }).passthrough(),
]);
const fileSideSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("available"), file: jsonValueSchema }),
  z.object({
    outcome: z.literal("unavailable"),
    code: z.string(),
    message: z.string(),
  }),
]);

const FILE_SIDE_STATUS: Readonly<Record<string, number>> = {
  ENOENT: 404,
  invalid_path: 400,
  file_too_large: 413,
};

const RETIRED_ERRORS: Readonly<
  Record<string, { status: number; code: string; message?: string }>
> = {
  not_found: {
    status: 404,
    code: "environment_not_found",
    message: "Environment not found",
  },
  conflict: {
    status: 409,
    code: "environment_not_ready",
    message: "Environment unavailable",
  },
  invalid: { status: 400, code: "invalid_request" },
  invalid_input: { status: 400, code: "invalid_request" },
};

function httpError(status: number, code: string, message: string): BbHttpError {
  return new BbHttpError({ body: { code, message }, code, message, status });
}

function retiredError(error: unknown): never {
  if (!(error instanceof BbHttpError) || error.code === null) throw error;
  const mapped = RETIRED_ERRORS[error.code];
  if (mapped === undefined) throw error;
  const body: unknown = error.body;
  const message =
    mapped.message ??
    (typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
      ? body.message
      : error.message);
  throw httpError(mapped.status, mapped.code, message);
}

function branchListLimit(limit: string): number {
  if (!/^\d+$/u.test(limit) || Number(limit) <= 0) {
    throw httpError(400, "invalid_request", "limit must be a positive integer");
  }
  return Math.min(Number(limit), BRANCH_LIST_LIMIT_MAX);
}

function diffFileQuery(args: RetiredDiffFileArgs) {
  const side = { path: args.path, side: args.side };
  switch (args.target) {
    case "uncommitted":
      return { target: args.target, ...side };
    case "branch_committed":
    case "all":
      return { target: args.target, mergeBaseRef: args.mergeBaseRef, ...side };
    case "commit":
      return { target: args.target, sha: args.sha, ...side };
  }
}

function toWorkspaceDiffTarget(args: DiffTargetArgs): WorkspaceDiffTarget {
  switch (args.target) {
    case "uncommitted":
      return { type: "uncommitted" };
    case "branch_committed":
    case "all":
      return { type: args.target, mergeBaseBranch: args.mergeBaseBranch };
    case "commit":
      return { type: "commit", sha: args.sha };
  }
}

function patchKey(
  environmentId: string,
  target: WorkspaceDiffTarget,
  ignoreWhitespace: boolean,
  path: string,
): string {
  return JSON.stringify([environmentId, target, ignoreWhitespace, path, "current"]);
}

export function createRetiredEnvironmentReads(
  callRpc: PluginsArea["callRpc"],
) {
  function callGit(
    method: string,
    input: JsonValue,
    signal: AbortSignal | undefined,
  ): Promise<JsonValue> {
    return callRpc({
      pluginId: GIT_PLUGIN_ID,
      method,
      input,
      outputSchema: jsonValueSchema,
      ...(signal === undefined ? {} : { signal }),
    }).catch(retiredError);
  }

  return {
    status(args: EnvironmentReadArgs & { mergeBaseBranch?: string }) {
      return callGit(
        "workspaceStatus",
        {
          environmentId: args.environmentId,
          ...(args.mergeBaseBranch === undefined
            ? {}
            : { mergeBaseBranch: args.mergeBaseBranch }),
        },
        args.signal,
      );
    },
    diff(args: EnvironmentReadArgs & DiffTargetArgs) {
      return callGit(
        "diff",
        { environmentId: args.environmentId, target: toWorkspaceDiffTarget(args) },
        args.signal,
      );
    },
    diffFiles(
      args: EnvironmentReadArgs & DiffTargetArgs & { ignoreWhitespace?: boolean },
    ) {
      return callGit(
        "files",
        {
          environmentId: args.environmentId,
          target: toWorkspaceDiffTarget(args),
          ignoreWhitespace: args.ignoreWhitespace === true,
        },
        args.signal,
      );
    },
    async diffPatch(
      args: EnvironmentReadArgs & {
        target: WorkspaceDiffTarget;
        paths: string[];
        ignoreWhitespace?: boolean;
      },
    ) {
      const target = workspaceDiffTargetSchema.safeParse(args.target);
      if (!target.success) {
        throw httpError(400, "invalid_request", "Invalid diff target");
      }
      const ignoreWhitespace = args.ignoreWhitespace === true;
      const keys = args.paths.map((path) =>
        patchKey(args.environmentId, target.data, ignoreWhitespace, path),
      );
      const rows = recordSchema.parse(
        await callGit("patches", { keys }, args.signal),
      );
      const patches = [];
      for (const key of keys) {
        const row = rows[key];
        if (row === undefined) continue;
        const parsed = patchRowSchema.parse(row);
        if (parsed.outcome !== "available") return row;
        patches.push(parsed.patch);
      }
      return { outcome: "available", patches };
    },
    async diffFile(args: RetiredDiffFileArgs) {
      const side = fileSideSchema.parse(
        await callGit(
          "fileSide",
          { environmentId: args.environmentId, query: diffFileQuery(args) },
          args.signal,
        ),
      );
      if (side.outcome === "available") return side.file;
      throw httpError(
        FILE_SIDE_STATUS[side.code] ?? 400,
        side.code,
        side.message,
      );
    },
    diffBranches(
      args: EnvironmentReadArgs & {
        query?: string;
        limit?: string;
        selectedBranch?: string;
      },
    ) {
      return callGit(
        "branches",
        {
          environmentId: args.environmentId,
          ...(args.query === undefined || args.query.trim() === ""
            ? {}
            : { query: args.query.trim() }),
          ...(args.limit === undefined
            ? {}
            : { limit: branchListLimit(args.limit) }),
          ...(args.selectedBranch === undefined
            ? {}
            : { selectedBranch: args.selectedBranch }),
        },
        args.signal,
      );
    },
  };
}
