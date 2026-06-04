import {
  createNodeBbSdk,
  type BbSdk,
  type BbSdkContext,
} from "@bb/sdk/node";

export interface CreateCliBbSdkOptions {
  context?: BbSdkContext;
}

export function createCliBbSdk(
  baseUrl: string,
  options: CreateCliBbSdkOptions = {},
): BbSdk {
  return createNodeBbSdk({ baseUrl, context: options.context });
}
