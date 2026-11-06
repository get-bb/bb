import { operationBodyFromResponse } from "@bb/operations";
import {
  publicRouteIndex,
  routeRequestFromInput,
  type PublicOperationInput,
  type PublicOperationName,
  type PublicOperationOutput,
} from "@bb/server-contract";
import type { BbSdkTransport } from "./transport.js";

type RouteCall = (...args: unknown[]) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RouteShape = (typeof publicRouteIndex)[PublicOperationName];

function routeEndpoint(
  transport: BbSdkTransport,
  route: RouteShape,
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

const PATH_SAFE = /%(?:21|24|26|27|28|29|2A|2B|2C|3A|3B|3D|40)/giu;

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(PATH_SAFE, decodeURIComponent);
}

function encodedParams(
  path: string,
  param: Record<string, unknown>,
): Record<string, string> {
  const encoded: Record<string, string> = {};
  for (const [key, value] of Object.entries(param)) {
    const text = String(value);
    encoded[key] = path.includes(`:${key}{`)
      ? text.split("/").map(encodeSegment).join("/")
      : encodeSegment(text);
  }
  return encoded;
}

export interface OperationCallOptions {
  signal?: AbortSignal;
  headers?: Readonly<Record<string, string>>;
  keepalive?: boolean;
}

function clientOptions(options: OperationCallOptions): unknown[] {
  const init = {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.keepalive === undefined
      ? {}
      : { keepalive: options.keepalive }),
  };
  const hasInit = Object.keys(init).length > 0;
  if (!hasInit && options.headers === undefined) return [];
  return [
    {
      ...(hasInit ? { init } : {}),
      ...(options.headers === undefined ? {} : { headers: options.headers }),
    },
  ];
}

function request(
  transport: BbSdkTransport,
  name: PublicOperationName,
  input: unknown,
  options: OperationCallOptions,
): Promise<Response> {
  const route = publicRouteIndex[name];
  const { param, ...rest } = routeRequestFromInput(route, input);
  return transport.resolve(
    routeEndpoint(transport, route)(
      param === undefined
        ? rest
        : { ...rest, param: encodedParams(route.path, param) },
      ...clientOptions(options),
    ),
  );
}

export interface OperationCaller {
  call<Name extends PublicOperationName>(
    name: Name,
    input: PublicOperationInput<Name>,
    options?: OperationCallOptions,
  ): Promise<PublicOperationOutput<Name>>;
  send<Name extends PublicOperationName>(
    name: Name,
    input: PublicOperationInput<Name>,
    options?: OperationCallOptions,
  ): Promise<void>;
}

export function createOperationCaller(
  transport: BbSdkTransport,
): OperationCaller {
  return {
    async call(name, input, options = {}) {
      const response = await request(transport, name, input, options);
      if (publicRouteIndex[name].format !== "json") {
        return operationBodyFromResponse(response) as PublicOperationOutput<
          typeof name
        >;
      }
      if (response.status === 204) {
        return null as PublicOperationOutput<typeof name>;
      }
      return (await response.json()) as PublicOperationOutput<typeof name>;
    },
    async send(name, input, options = {}) {
      await request(transport, name, input, options);
    },
  };
}
