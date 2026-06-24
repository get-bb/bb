import {
  BbHttpError as InternalBbHttpError,
  BbRequestTimeoutError as InternalBbRequestTimeoutError,
  ThreadWaitTimeoutError as InternalThreadWaitTimeoutError,
  ThreadWaitUnreachableError as InternalThreadWaitUnreachableError,
  createNodeBbSdk,
} from "@bb/sdk/node";

export type JsonValue =
  | JsonValue[]
  | boolean
  | null
  | number
  | string
  | { [key: string]: JsonValue };

export type ThreadStatus =
  | "idle"
  | "starting"
  | "active"
  | "stopping"
  | "error";

export type PermissionMode = "full" | "workspace-write" | "readonly";
export type ReasoningLevel = "low" | "medium" | "high" | "xhigh" | "max";
export type ServiceTier = "fast" | "default";
export type ExecutionInputSource = "explicit" | "client-preference";

export interface CreateExecutionInputSources {
  model?: ExecutionInputSource;
  permissionMode?: ExecutionInputSource;
  providerId?: ExecutionInputSource;
  reasoningLevel?: ExecutionInputSource;
  serviceTier?: ExecutionInputSource;
}

export interface ExistingThreadExecutionInputSources {
  model?: ExecutionInputSource;
  permissionMode?: ExecutionInputSource;
  reasoningLevel?: ExecutionInputSource;
  serviceTier?: ExecutionInputSource;
}

export interface PromptTextMention {
  end: number;
  resource:
    | {
        kind: "thread";
        label: string;
        projectId?: string;
        threadId: string;
      }
    | {
        kind: "path";
        entryKind: "directory" | "file";
        label: string;
        path: string;
        source: "thread-storage" | "workspace";
      }
    | {
        kind: "command";
        argumentHint: string | null;
        label: string;
        name: string;
        origin: "project" | "user";
        source: "command" | "skill";
        trigger: "/";
      };
  start: number;
}

export type PromptInput =
  | {
      type: "text";
      text: string;
      mentions: PromptTextMention[];
      visibility?: "agent-only";
    }
  | {
      type: "image";
      url: string;
      visibility?: "agent-only";
    }
  | {
      type: "localImage";
      path: string;
      visibility?: "agent-only";
    }
  | {
      type: "localFile";
      path: string;
      name?: string;
      sizeBytes?: number;
      mimeType?: string;
      visibility?: "agent-only";
    };

export type BaseBranchSpec =
  | { kind: "default" }
  | { kind: "named"; name: string };

export type UnmanagedBranchSpec =
  | { kind: "existing"; name: string }
  | { kind: "new"; baseBranch: string };

export type WorkspaceArgs =
  | {
      type: "unmanaged";
      path: string | null;
      branch?: UnmanagedBranchSpec;
    }
  | {
      type: "managed-worktree";
      baseBranch: BaseBranchSpec;
    }
  | { type: "personal" };

export type EnvironmentArgs =
  | { type: "reuse"; environmentId: string }
  | {
      type: "host";
      hostId?: string;
      workspace: WorkspaceArgs;
    };

export interface BBSdkOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  realtimeUrl?: string;
  timeoutMs?: number;
  websocket?: BBSdkRealtimeSocketFactory;
}

export interface BBSdkRealtimeSocketMessageEvent {
  data: unknown;
}

export interface BBSdkRealtimeSocket {
  close(): void;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: BBSdkRealtimeSocketMessageEvent) => void) | null;
  onopen: (() => void) | null;
  readyState: number;
  send(data: string): void;
}

export type BBSdkRealtimeSocketFactory = (url: string) => BBSdkRealtimeSocket;

export interface ThreadSpawnBaseArgs {
  environment: EnvironmentArgs;
  executionInputSources?: CreateExecutionInputSources;
  model?: string;
  parentThreadId?: string;
  permissionMode?: PermissionMode;
  projectId: string;
  providerId?: string;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: ServiceTier;
  sourceSeqEnd?: number;
  sourceThreadId?: string;
  title?: string;
}

export type ThreadSpawnArgs = ThreadSpawnBaseArgs &
  (
    | {
        input: PromptInput[];
        prompt?: never;
      }
    | {
        input?: never;
        prompt: string;
      }
  );

export interface ThreadSendArgs {
  executionInputSources?: ExistingThreadExecutionInputSources;
  input: PromptInput[];
  mode: "queue-if-active" | "steer-if-active" | "auto" | "start" | "steer";
  model?: string;
  permissionMode?: PermissionMode;
  reasoningLevel?: ReasoningLevel;
  senderThreadId?: string;
  serviceTier?: ServiceTier;
  threadId: string;
}

export interface ThreadWaitArgs {
  event?: string;
  pollIntervalMs?: number;
  status?: ThreadStatus;
  threadId: string;
  timeoutMs?: number;
}

export interface ThreadListArgs {
  archived?: boolean;
  hasParent?: boolean;
  parentThreadId?: string;
  projectId?: string;
}

export interface ThreadGetArgs {
  include?: string;
  threadId: string;
}

export interface ThreadIdArgs {
  threadId: string;
}

export interface BBSdkThread {
  id: string;
  projectId: string;
  status: ThreadStatus;
  title: string | null;
  [key: string]: unknown;
}

export interface BBSdkThreadsArea {
  archive(args: ThreadIdArgs): Promise<{ ok: true }>;
  get(args: ThreadGetArgs): Promise<BBSdkThread>;
  list(args?: ThreadListArgs): Promise<BBSdkThread[]>;
  output(args: ThreadIdArgs): Promise<{ output: string | null }>;
  send(args: ThreadSendArgs): Promise<{ ok: true }>;
  spawn(args: ThreadSpawnArgs): Promise<BBSdkThread>;
  stop(args: ThreadIdArgs): Promise<{ ok: true }>;
  timeline(
    args: ThreadIdArgs & Record<string, string | undefined>,
  ): Promise<unknown>;
  unarchive(args: ThreadIdArgs): Promise<{ ok: true }>;
  wait(args: ThreadWaitArgs): Promise<unknown>;
}

export interface BBSdkStatusArea {
  get(args?: { projectId?: string; threadId?: string }): Promise<unknown>;
}

export interface BBSdkRealtimeOnArgs {
  callback: (event: unknown) => void;
  event:
    | "thread:changed"
    | "project:changed"
    | "environment:changed"
    | "host:changed"
    | "system:changed"
    | "system:config-changed"
    | "realtime:connection";
  environmentId?: string;
  hostId?: string;
  projectId?: string;
  threadId?: string;
}

export interface BbHttpErrorArgs {
  code: string | null;
  message: string;
  status: number;
}

export interface BbHttpError extends Error {
  readonly code: string | null;
  readonly status: number;
}

export interface BbHttpErrorConstructor {
  new (args: BbHttpErrorArgs): BbHttpError;
  readonly prototype: BbHttpError;
}

export interface BbRequestTimeoutError extends Error {}

export interface BbRequestTimeoutErrorConstructor {
  new (timeoutMs: number): BbRequestTimeoutError;
  readonly prototype: BbRequestTimeoutError;
}

export interface ThreadWaitTimeoutError extends Error {}

export interface ThreadWaitTimeoutErrorConstructor {
  readonly prototype: ThreadWaitTimeoutError;
}

export interface ThreadWaitUnreachableError extends Error {}

export interface ThreadWaitUnreachableErrorConstructor {
  readonly prototype: ThreadWaitUnreachableError;
}

export const BbHttpError: BbHttpErrorConstructor = InternalBbHttpError;
export const BbRequestTimeoutError: BbRequestTimeoutErrorConstructor =
  InternalBbRequestTimeoutError;
export const ThreadWaitTimeoutError: ThreadWaitTimeoutErrorConstructor =
  InternalThreadWaitTimeoutError;
export const ThreadWaitUnreachableError: ThreadWaitUnreachableErrorConstructor =
  InternalThreadWaitUnreachableError;

export class BBSdk {
  #sdk: ReturnType<typeof createNodeBbSdk>;

  readonly automations: object;
  readonly environments: object;
  readonly guide: object;
  readonly hosts: object;
  readonly projects: object;
  readonly providers: object;
  readonly status: BBSdkStatusArea;
  readonly theme: object;
  readonly threads: BBSdkThreadsArea;

  constructor(options: BBSdkOptions = {}) {
    const sdk = createNodeBbSdk(options);
    this.#sdk = sdk;
    this.automations = sdk.automations;
    this.environments = sdk.environments;
    this.guide = sdk.guide;
    this.hosts = sdk.hosts;
    this.projects = sdk.projects;
    this.providers = sdk.providers;
    this.status = {
      get: (args) => sdk.status.get(args),
    };
    this.theme = sdk.theme;
    this.threads = {
      archive: (args) => sdk.threads.archive(args),
      get: (args) => sdk.threads.get(args),
      list: (args) => sdk.threads.list(args),
      output: (args) => sdk.threads.output(args),
      send: (args) => sdk.threads.send(args),
      spawn: (args) => sdk.threads.spawn(args),
      stop: (args) => sdk.threads.stop(args),
      timeline: (args) => sdk.threads.timeline(args),
      unarchive: (args) => sdk.threads.unarchive(args),
      wait: (args) => sdk.threads.wait(args),
    };
  }

  on(args: BBSdkRealtimeOnArgs): () => void {
    return this.#sdk.on(args);
  }
}

export function createBBSdk(options: BBSdkOptions = {}): BBSdk {
  return new BBSdk(options);
}
