import {
  browserCaptureDescriptorSchema,
  browserCaptureReadResponseSchema,
  browserWaitResultSchema,
  assembleBrowserCapture,
} from "@bb/server-contract";
import type {
  BrowserBatchRequest,
  BrowserCaptureDescriptor,
  JsonValue,
  BrowserBatchResponse,
  BrowserCaptureReadResponse,
  BrowserControlError,
  BrowserControlRequest,
  BrowserControlResponse,
  BrowserFrameDescriptor,
  BrowserFrameTarget,
  BrowserOpenRequest,
  BrowserOpenResponse,
  BrowserPageLocator,
  BrowserPluginContributionResponse,
  BrowserTabTarget,
  BrowserTabsResponse,
  BrowserWaitCriteria,
  BrowserWaitResult,
} from "@bb/server-contract";
export type {
  BrowserCaptureDescriptor,
  BrowserCaptureReadResponse,
  BrowserControlError,
  BrowserFrameDescriptor,
  BrowserFrameTarget,
  BrowserPluginContributionResponse,
  BrowserWaitCriteria,
  BrowserWaitResult,
};
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface BrowserTabsArgs {
  signal?: AbortSignal;
}

export interface BrowserBatchArgs extends BrowserBatchRequest {
  signal?: AbortSignal;
}

export interface BrowserControlArgs extends BrowserControlRequest {
  signal?: AbortSignal;
}

export interface BrowserOpenArgs extends BrowserOpenRequest {
  signal?: AbortSignal;
}

export interface BrowserWaitArgs {
  target: BrowserTabTarget;
  criteria: BrowserWaitCriteria;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface BrowserCaptureReadArgs {
  clientId: string;
  windowId: string;
  tabId: string;
  captureId: string;
  offset: number;
  length: number;
  signal?: AbortSignal;
}

export interface BrowserCaptureCreateArgs {
  clientId: string;
  windowId: string;
  tabId: string;
  mode: "viewport" | "full-page" | "element";
  format?: "png" | "jpeg";
  quality?: number;
  locator?: BrowserPageLocator;
  expectedNavigationEpoch: number;
  signal?: AbortSignal;
}

export interface BrowserCaptureReleaseArgs {
  clientId: string;
  windowId: string;
  tabId: string;
  captureId: string;
  signal?: AbortSignal;
}

export interface BrowserCaptureDownloadResult {
  bytes: Uint8Array;
  mimeType: BrowserCaptureDescriptor["mimeType"];
  pixelSize: { width: number; height: number };
}

export interface BrowserCaptureDownloadArgs {
  descriptor: BrowserCaptureDescriptor;
  signal?: AbortSignal;
}

export interface BrowserPluginContributionArgs {
  pluginId: string;
  controllerId: string;
  target: BrowserTabTarget;
  input: JsonValue;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type BrowserBatchResult = BrowserBatchResponse;
export type BrowserTabsResult = BrowserTabsResponse;
export type BrowserControlResult = BrowserControlResponse;
export type BrowserOpenResult = BrowserOpenResponse;

export interface BrowserArea {
  batch(args: BrowserBatchArgs): Promise<BrowserBatchResult>;
  control(args: BrowserControlArgs): Promise<BrowserControlResult>;
  open(args: BrowserOpenArgs): Promise<BrowserOpenResult>;
  tabs(args?: BrowserTabsArgs): Promise<BrowserTabsResult>;
  wait(args: BrowserWaitArgs): Promise<BrowserWaitResult>;
  captureRead(
    args: BrowserCaptureReadArgs,
  ): Promise<BrowserCaptureReadResponse>;
  capture(args: BrowserCaptureCreateArgs): Promise<BrowserCaptureDescriptor>;
  captureRelease(
    args: BrowserCaptureReleaseArgs,
  ): Promise<{ released: boolean }>;
  captureDownload(
    args: BrowserCaptureDownloadArgs,
  ): Promise<BrowserCaptureDownloadResult>;
  experimental_requestContribution(
    args: BrowserPluginContributionArgs,
  ): Promise<BrowserPluginContributionResponse>;
}

export function createBrowserArea(args: CreateSdkAreaArgs): BrowserArea {
  const { transport } = args;
  return {
    batch(input) {
      const { signal, ...json } = input;
      return transport.readJson(
        transport.api.v1.browser.batch.$post(
          { json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    tabs(input = {}) {
      return transport.readJson(
        transport.api.v1.browser.tabs.$get(
          {},
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    open(input) {
      const { signal, ...json } = input;
      return transport.readJson(
        transport.api.v1.browser.open.$post(
          { json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    control(input) {
      const { signal, ...json } = input;
      return transport.readJson(
        transport.api.v1.browser.control.$post(
          { json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    wait(input) {
      return transport
        .readJson(
          transport.api.v1.browser.control.$post(
            {
              json: {
                action: { kind: "wait", criteria: input.criteria },
                target: input.target,
                timeoutMs: input.timeoutMs,
              },
            },
            ...signalRequestArgs(input.signal),
          ),
        )
        .then((response: BrowserControlResponse) => {
          const parsed = browserWaitResultSchema.safeParse(response.value);
          if (!parsed.success) {
            throw new Error("Browser wait returned an invalid typed result");
          }
          if (parsed.data.kind !== input.criteria.kind) {
            throw new Error(
              "Browser wait result kind does not match the request",
            );
          }
          return parsed.data;
        });
    },
    captureRead(input) {
      const { signal, ...json } = input;
      return transport
        .readJson(
          transport.api.v1.browser.capture.$post(
            { json },
            ...signalRequestArgs(signal),
          ),
        )
        .then((response: unknown) => {
          const parsed = browserCaptureReadResponseSchema.safeParse(response);
          if (!parsed.success) {
            throw new Error("Browser capture read returned an invalid chunk");
          }
          return parsed.data;
        });
    },
    capture(input) {
      const { signal, ...json } = input;
      return transport
        .readJson(
          transport.api.v1.browser["capture-create"].$post(
            { json },
            ...signalRequestArgs(signal),
          ),
        )
        .then((descriptor: unknown) => {
          const parsed = browserCaptureDescriptorSchema.safeParse(descriptor);
          if (!parsed.success) {
            throw new Error("Browser capture returned an invalid descriptor");
          }
          if (
            parsed.data.target.clientId !== input.clientId ||
            parsed.data.target.windowId !== input.windowId ||
            parsed.data.target.tabId !== input.tabId ||
            parsed.data.target.navigationEpoch !== input.expectedNavigationEpoch
          ) {
            throw new Error("Browser tab changed before the capture completed");
          }
          return parsed.data;
        });
    },
    captureRelease(input) {
      const { signal, ...json } = input;
      return transport.readJson(
        transport.api.v1.browser["capture-release"].$post(
          { json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    async captureDownload(input) {
      const { descriptor } = input;
      const bytes = await assembleBrowserCapture({
        descriptor,
        signal: input.signal,
        read: (request) =>
          this.captureRead({
            ...request,
            clientId: descriptor.target.clientId,
            windowId: descriptor.target.windowId,
            tabId: descriptor.target.tabId,
            signal: input.signal,
          }),
        release: () =>
          this.captureRelease({
            clientId: descriptor.target.clientId,
            windowId: descriptor.target.windowId,
            tabId: descriptor.target.tabId,
            captureId: descriptor.captureId,
          }),
      });
      return {
        bytes,
        mimeType: descriptor.mimeType,
        pixelSize: descriptor.pixelSize,
      };
    },
    experimental_requestContribution(input) {
      const { signal, ...json } = input;
      return transport.readJson(
        transport.api.v1.browser.plugin.$post(
          { json },
          ...signalRequestArgs(signal),
        ),
      );
    },
  };
}
