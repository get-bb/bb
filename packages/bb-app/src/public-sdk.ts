import {
  BbHttpError,
  BbRequestTimeoutError,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
  createNodeBbSdk,
  type BbSdk,
  type CreateNodeBbSdkArgs,
} from "@bb/sdk/node";
import type {
  BbRealtimeOnArgs,
  BbRealtimeSocket,
  BbRealtimeSocketFactory,
  BbRealtimeSocketMessageEvent,
  ThreadGetResult,
  ThreadStatusArgs,
} from "@bb/sdk/node";

export {
  BbHttpError,
  BbRequestTimeoutError,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
};
export type * from "@bb/sdk/node";
export type {
  JsonValue,
  PermissionMode,
  PromptInput,
  PromptTextMention,
  ReasoningLevel,
  ServiceTier,
  ThreadStatus,
} from "@bb/sdk/node";
export type {
  BaseBranchSpec,
  CreateExecutionInputSources,
  EnvironmentArgs,
  ExistingThreadExecutionInputSources,
  UnmanagedBranchSpec,
  WorkspaceArgs,
} from "@bb/sdk/node";
export type { CallerExecutionInputSource as ExecutionInputSource } from "@bb/sdk/node";

export type BBSdkOptions = CreateNodeBbSdkArgs;
export type BBSdkRealtimeOnArgs = BbRealtimeOnArgs;
export type BBSdkRealtimeSocket = BbRealtimeSocket;
export type BBSdkRealtimeSocketFactory = BbRealtimeSocketFactory;
export type BBSdkRealtimeSocketMessageEvent = BbRealtimeSocketMessageEvent;
export type BBSdkStatusArea = BbSdk["status"];
export type BBSdkThread = ThreadGetResult;
export type BBSdkThreadsArea = BbSdk["threads"];
export type ThreadIdArgs = ThreadStatusArgs;
export type BbHttpErrorConstructor = typeof BbHttpError;
export type BbRequestTimeoutErrorConstructor = typeof BbRequestTimeoutError;
export type ThreadWaitTimeoutErrorConstructor = typeof ThreadWaitTimeoutError;
export type ThreadWaitUnreachableErrorConstructor =
  typeof ThreadWaitUnreachableError;

/**
 * Public npm façade over the canonical BB SDK. Keep every area typed from
 * `@bb/sdk` so the packaged SDK cannot drift behind the CLI or web app.
 */
export class BBSdk implements BbSdk {
  readonly environments: BbSdk["environments"];
  readonly files: BbSdk["files"];
  readonly guide: BbSdk["guide"];
  readonly hosts: BbSdk["hosts"];
  readonly plugins: BbSdk["plugins"];
  readonly projects: BbSdk["projects"];
  readonly providers: BbSdk["providers"];
  readonly status: BbSdk["status"];
  readonly system: BbSdk["system"];
  readonly theme: BbSdk["theme"];
  readonly threadFolders: BbSdk["threadFolders"];
  readonly threads: BbSdk["threads"];
  readonly on: BbSdk["on"];

  constructor(options: BBSdkOptions = {}) {
    const sdk = createNodeBbSdk(options);
    this.environments = sdk.environments;
    this.files = sdk.files;
    this.guide = sdk.guide;
    this.hosts = sdk.hosts;
    this.plugins = sdk.plugins;
    this.projects = sdk.projects;
    this.providers = sdk.providers;
    this.status = sdk.status;
    this.system = sdk.system;
    this.theme = sdk.theme;
    this.threadFolders = sdk.threadFolders;
    this.threads = sdk.threads;
    this.on = sdk.on;
  }
}

export function createBBSdk(options: BBSdkOptions = {}): BBSdk {
  return new BBSdk(options);
}
