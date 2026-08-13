import type { AddressInfo } from "node:net";

export type MockService = "platform" | "assurance-studio";

export type MockMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface MockRoute {
  routeId: string;
  service: MockService;
  method: MockMethod;
  pathTemplate: string;
  operationId: string | null;
  auth: "X-Authorization" | "X-API-Key";
  requestMediaTypes: readonly string[];
  responseStatuses: readonly number[];
  source: "openapi" | "handler-audit" | "client-contract";
  evidence?: string;
}

export interface MockHandlerContext {
  readonly service: MockService;
  readonly route: MockRoute;
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly fixtureRoot: string;
}

export type MockHandler = (
  context: MockHandlerContext,
) => Response | Promise<Response>;

export interface MockHandlerRegistry {
  register(routeId: string, handler: MockHandler): void;
  onReset(reset: () => void | Promise<void>): void;
}

export interface MockRemoteOptions {
  platformToken: string;
  assuranceStudioKey: string;
  fixtureRoot: string;
  register?: (service: MockService, registry: MockHandlerRegistry) => void;
}

export interface MockServiceServer {
  readonly service: MockService;
  readonly routes: readonly MockRoute[];
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  listen(): Promise<string>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export interface MockRemoteHarness {
  platform: MockServiceServer;
  assuranceStudio: MockServiceServer;
  listen(): Promise<{
    platformBaseUrl: string;
    assuranceStudioBaseUrl: string;
  }>;
  reset(service?: MockService): Promise<void>;
  close(): Promise<void>;
}

export function loopbackBaseUrl(address: AddressInfo): string {
  return `http://127.0.0.1:${address.port}`;
}
