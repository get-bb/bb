import type { BbSdkContext, BbSdkTransport } from "../transport.js";

export interface CreateSdkAreaArgs {
  context: BbSdkContext;
  transport: BbSdkTransport;
}

export interface OkResponse {
  ok: true;
}

export interface ThreadIdArgs {
  threadId: string;
}

export interface ProjectIdArgs {
  projectId: string;
}

export interface EnvironmentIdArgs {
  environmentId: string;
}

export interface HostIdArgs {
  hostId: string;
}

export interface ApplicationIdArgs {
  applicationId: string;
}

export function requireCurrentApplicationId(context: BbSdkContext): string {
  if (!context.applicationId) {
    throw new Error("current_app_unavailable");
  }
  return context.applicationId;
}

export function optionalQueryValue(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}
