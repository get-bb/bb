import type { BbSdkContext, BbSdkTransport } from "../transport.js";

export interface CreateSdkAreaArgs {
  context: BbSdkContext;
  transport: BbSdkTransport;
}

export interface OkResponse {
  ok: true;
}

export function requireCurrentApplicationId(context: BbSdkContext): string {
  if (!context.applicationId) {
    throw new Error("current_app_unavailable");
  }
  return context.applicationId;
}
