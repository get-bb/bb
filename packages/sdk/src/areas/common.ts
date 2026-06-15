import type { BbSdkContext, BbSdkTransport } from "../transport.js";

export interface CreateSdkAreaArgs {
  context: BbSdkContext;
  transport: BbSdkTransport;
}

export interface OkResponse {
  ok: true;
}
