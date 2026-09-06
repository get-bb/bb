import type { BbSdk } from "@bb/sdk";
import {
  browserAnnotationRequestSchema,
  validateBrowserAnnotationOperationResult,
  type BrowserAnnotationOperation,
  type BrowserAnnotationOperationValue,
  type BrowserAnnotationTarget,
} from "./contracts.js";

export const BROWSER_ANNOTATIONS_PLUGIN_ID = "browser-annotations";
export const BROWSER_ANNOTATIONS_CONTROLLER_ID = "annotations";
export interface BrowserAnnotationsSdk {
  browser: Pick<
    BbSdk["browser"],
    "experimental_requestContribution"
  >;
}

export interface BrowserAnnotationsClient {
  request<T extends BrowserAnnotationOperation>(
    target: BrowserAnnotationTarget,
    operation: T,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<BrowserAnnotationOperationValue<T>>;
}

export function createBrowserAnnotationsClient(
  sdk: BrowserAnnotationsSdk,
): BrowserAnnotationsClient {
  return {
    async request<T extends BrowserAnnotationOperation>(
      target: BrowserAnnotationTarget,
      operation: T,
      options: { timeoutMs?: number; signal?: AbortSignal } = {},
    ): Promise<BrowserAnnotationOperationValue<T>> {
      const parsed = browserAnnotationRequestSchema.parse({
        target,
        operation,
        timeoutMs: options.timeoutMs,
      });
      options.signal?.throwIfAborted();
      const response = await sdk.browser.experimental_requestContribution({
        pluginId: BROWSER_ANNOTATIONS_PLUGIN_ID,
        controllerId: BROWSER_ANNOTATIONS_CONTROLLER_ID,
        target: parsed.target,
        input: parsed.operation,
        timeoutMs: parsed.timeoutMs,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      options.signal?.throwIfAborted();
      return validateBrowserAnnotationOperationResult(
        operation,
        response.value,
      );
    },
  };
}
