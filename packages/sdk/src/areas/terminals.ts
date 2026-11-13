import type {
  CreateTerminalRequest,
  TerminalInputRequest,
  TerminalListQuery,
  TerminalListResponse,
  TerminalOutputQuery,
  TerminalOutputResponse,
  TerminalResizeRequest,
  TerminalSession,
  UpdateTerminalRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface TerminalThreadScope {
  cwd?: never;
  environmentId?: never;
  hostId?: never;
  kind: "thread";
  threadId: string;
}

export interface TerminalEnvironmentScope {
  environmentId: string;
  cwd?: never;
  hostId?: never;
  kind: "environment";
  threadId?: never;
}

export interface TerminalHostPathListScope {
  cwd?: string;
  environmentId?: never;
  hostId: string;
  kind: "host_path";
  threadId?: never;
}

export interface TerminalHostPathCreateScope {
  cwd: string | null;
  environmentId?: never;
  hostId: string;
  kind: "host_path";
  threadId?: never;
}

export type TerminalListScope =
  | TerminalThreadScope
  | TerminalEnvironmentScope
  | TerminalHostPathListScope;

export type TerminalCreateScope =
  | TerminalThreadScope
  | TerminalEnvironmentScope
  | TerminalHostPathCreateScope;

export interface TerminalListArgs {
  signal?: AbortSignal;
  scope: TerminalListScope;
}

export interface TerminalCreateArgs {
  cols: number;
  id?: CreateTerminalRequest["id"];
  rows: number;
  scope: TerminalCreateScope;
  start?: CreateTerminalRequest["start"];
  title?: string;
}

export interface TerminalTargetArgs {
  terminalId: string;
}

export interface TerminalGetArgs extends TerminalTargetArgs {
  signal?: AbortSignal;
}

export interface TerminalRenameArgs extends TerminalTargetArgs {
  title: UpdateTerminalRequest["title"];
}

export interface TerminalCloseArgs extends TerminalTargetArgs {
  mode: "force" | "if-clean";
}

export interface TerminalInputArgs extends TerminalTargetArgs {
  dataBase64: TerminalInputRequest["dataBase64"];
}

export interface TerminalResizeArgs extends TerminalTargetArgs {
  cols: TerminalResizeRequest["cols"];
  rows: TerminalResizeRequest["rows"];
}

export interface TerminalOutputArgs extends TerminalTargetArgs {
  limitChunks?: TerminalOutputQuery["limitChunks"];
  signal?: AbortSignal;
  sinceSeq?: TerminalOutputQuery["sinceSeq"];
  tailBytes?: TerminalOutputQuery["tailBytes"];
}

export type TerminalRestartArgs = TerminalTargetArgs;

export type TerminalListResult = TerminalListResponse;
export type TerminalCreateResult = TerminalSession;
export type TerminalGetResult = TerminalSession;
export type TerminalRenameResult = TerminalSession;
export type TerminalCloseResult = TerminalSession;
export type TerminalInputResult = TerminalSession;
export type TerminalResizeResult = TerminalSession;
export type TerminalOutputResult = TerminalOutputResponse;
export type TerminalRestartResult = TerminalSession;

export interface TerminalsArea {
  close(args: TerminalCloseArgs): Promise<TerminalCloseResult>;
  create(args: TerminalCreateArgs): Promise<TerminalCreateResult>;
  get(args: TerminalGetArgs): Promise<TerminalGetResult>;
  input(args: TerminalInputArgs): Promise<TerminalInputResult>;
  list(args: TerminalListArgs): Promise<TerminalListResult>;
  output(args: TerminalOutputArgs): Promise<TerminalOutputResult>;
  rename(args: TerminalRenameArgs): Promise<TerminalRenameResult>;
  restart(args: TerminalRestartArgs): Promise<TerminalRestartResult>;
  resize(args: TerminalResizeArgs): Promise<TerminalResizeResult>;
}

function assertUnambiguousScope(
  scope: TerminalListScope | TerminalCreateScope,
): void {
  switch (scope.kind) {
    case "thread":
      if ("environmentId" in scope || "hostId" in scope || "cwd" in scope) {
        throw new Error(
          "Thread terminal scope cannot include environment or host selectors.",
        );
      }
      return;
    case "environment":
      if ("threadId" in scope || "hostId" in scope || "cwd" in scope) {
        throw new Error(
          "Environment terminal scope cannot include thread or host selectors.",
        );
      }
      return;
    case "host_path":
      if ("threadId" in scope || "environmentId" in scope) {
        throw new Error(
          "Host terminal scope cannot include thread or environment selectors.",
        );
      }
  }
}

function terminalListQuery(scope: TerminalListScope): TerminalListQuery {
  assertUnambiguousScope(scope);
  switch (scope.kind) {
    case "thread":
      return { threadId: scope.threadId };
    case "environment":
      return { environmentId: scope.environmentId };
    case "host_path":
      return {
        hostId: scope.hostId,
        ...(scope.cwd === undefined ? {} : { cwd: scope.cwd }),
      };
  }
}

function terminalCreateTarget(
  scope: TerminalCreateScope,
): CreateTerminalRequest["target"] {
  assertUnambiguousScope(scope);
  switch (scope.kind) {
    case "thread":
      return { kind: "thread", threadId: scope.threadId };
    case "environment":
      return { kind: "environment", environmentId: scope.environmentId };
    case "host_path":
      return {
        kind: "host_path",
        hostId: scope.hostId,
        cwd: scope.cwd,
      };
  }
}

function terminalOutputQuery(args: TerminalOutputArgs): TerminalOutputQuery {
  return {
    ...(args.sinceSeq === undefined ? {} : { sinceSeq: args.sinceSeq }),
    ...(args.tailBytes === undefined ? {} : { tailBytes: args.tailBytes }),
    ...(args.limitChunks === undefined
      ? {}
      : { limitChunks: args.limitChunks }),
  };
}

export function createTerminalsArea(args: CreateSdkAreaArgs): TerminalsArea {
  const { call } = args.operations;
  return {
    close: ({ terminalId, mode }) =>
      call("terminals.close", { terminalId, mode, reason: "user" }),
    create: (input) =>
      call("terminals.create", {
        cols: input.cols,
        id: input.id,
        rows: input.rows,
        start: input.start,
        target: terminalCreateTarget(input.scope),
        title: input.title,
      }),
    get: ({ terminalId, signal }) =>
      call("terminals.get", { terminalId }, { signal }),
    input: ({ terminalId, dataBase64 }) =>
      call("terminals.input", { terminalId, dataBase64 }),
    async list({ scope, signal }) {
      return call("terminals.list", terminalListQuery(scope), { signal });
    },
    output: (input) =>
      call(
        "terminals.output",
        { terminalId: input.terminalId, ...terminalOutputQuery(input) },
        { signal: input.signal },
      ),
    rename: ({ terminalId, title }) =>
      call("terminals.update", { terminalId, title }),
    restart: ({ terminalId }) => call("terminals.restart", { terminalId }),
    resize: ({ terminalId, cols, rows }) =>
      call("terminals.resize", { terminalId, cols, rows }),
  };
}
