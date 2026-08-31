import type {
  BrowserAutomationCommand,
  BrowserAutomationTarget,
  BrowserPublicCommandResult,
  BrowserScreenshotArtifact,
  BrowserTargetListResponse,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface BrowserOwnerArgs {
  callerHostId: string;
  threadId: string;
}

export interface BrowserOpenArgs extends BrowserOwnerArgs {
  timeoutMs?: number;
  url: string;
}

export interface BrowserTargetArgs extends BrowserOwnerArgs {
  targetId: string;
}

export interface BrowserRunArgs extends BrowserTargetArgs {
  command: BrowserAutomationCommand;
  timeoutMs?: number;
}

export interface BrowserArtifactArgs extends BrowserOwnerArgs {
  artifactId: string;
}

export interface BrowserArea {
  close(args: BrowserTargetArgs): Promise<BrowserAutomationTarget>;
  downloadArtifact(args: BrowserArtifactArgs): Promise<Uint8Array>;
  getArtifact(args: BrowserArtifactArgs): Promise<BrowserScreenshotArtifact>;
  list(args: BrowserOwnerArgs): Promise<BrowserTargetListResponse>;
  open(args: BrowserOpenArgs): Promise<BrowserAutomationTarget>;
  run(args: BrowserRunArgs): Promise<BrowserPublicCommandResult>;
}

function ownerQuery(args: BrowserOwnerArgs) {
  return { callerHostId: args.callerHostId, threadId: args.threadId };
}

export function createBrowserArea({ transport }: CreateSdkAreaArgs): BrowserArea {
  return {
    async close(args) {
      return transport.readJson(transport.api.v1.browser.targets[":targetId"].close.$post({
        json: ownerQuery(args),
        param: { targetId: args.targetId },
      }));
    },
    async downloadArtifact(args) {
      const response = await transport.resolve(transport.api.v1.browser.artifacts[":artifactId"].content.$get({
        param: { artifactId: args.artifactId },
        query: ownerQuery(args),
      }));
      return new Uint8Array(await response.arrayBuffer());
    },
    async getArtifact(args) {
      return transport.readJson(transport.api.v1.browser.artifacts[":artifactId"].$get({
        param: { artifactId: args.artifactId },
        query: ownerQuery(args),
      }));
    },
    async list(args) {
      return transport.readJson(transport.api.v1.browser.targets.$get({ query: ownerQuery(args) }));
    },
    async open(args) {
      return transport.readJson(transport.api.v1.browser.targets.$post({
        json: {
          ...ownerQuery(args),
          timeoutMs: args.timeoutMs,
          url: args.url,
        },
      }));
    },
    async run(args) {
      return transport.readJson(transport.api.v1.browser.targets[":targetId"].commands.$post({
        json: {
          ...ownerQuery(args),
          command: args.command,
          timeoutMs: args.timeoutMs,
        },
        param: { targetId: args.targetId },
      }));
    },
  };
}
