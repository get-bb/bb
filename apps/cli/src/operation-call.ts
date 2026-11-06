import { operationBodyFromResponse } from "@bb/operations";
import {
  publicOperationRouteDefinition,
  routeRequestFromInput,
  routeReturnsBody,
} from "@bb/server-contract";
import type { BbSdkTransport } from "@bb/sdk/node";
import { createCliTransport } from "./client.js";

type RouteCall = (...args: unknown[]) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function routeEndpoint(
  transport: BbSdkTransport,
  route: { method: string; path: string },
): RouteCall {
  let node: unknown = transport.api.v1;
  for (const segment of route.path.split("/").filter(Boolean)) {
    node =
      isRecord(node) || typeof node === "function"
        ? Reflect.get(node, segment)
        : undefined;
  }
  const call =
    isRecord(node) || typeof node === "function"
      ? Reflect.get(node, `$${route.method}`)
      : undefined;
  if (typeof call !== "function") {
    throw new Error(`No client route for ${route.method} ${route.path}`);
  }
  return (...args) => Reflect.apply(call, undefined, args);
}

export interface OperationCaller {
  call(name: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
}

export function createOperationCaller(baseUrl: string): OperationCaller {
  let transport: BbSdkTransport | null = null;
  return {
    async call(name, input, signal) {
      transport ??= createCliTransport(baseUrl);
      const route = publicOperationRouteDefinition(name);
      if (route === null) throw new Error(`Unknown operation ${name}`);
      const response = await transport.resolve(
        routeEndpoint(transport, route)(
          routeRequestFromInput(route, input),
          ...(signal === undefined ? [] : [{ init: { signal } }]),
        ),
      );
      if (routeReturnsBody(route)) return operationBodyFromResponse(response);
      if (response.status === 204) return null;
      return response.json();
    },
  };
}
