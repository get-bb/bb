import { publicRouteIndex } from "./generated/route-index.js";
import type { PublicOperationName } from "./public-operations.js";
import { decodeRouteCall, type RouteCallShape } from "./route-calls.js";

const index: Readonly<Record<string, Readonly<Record<string, string>>>> =
  publicRouteIndex;

export function publicRouteCall(name: PublicOperationName): RouteCallShape {
  const dot = name.indexOf(".");
  const encoded = index[name.slice(0, dot)]?.[name.slice(dot + 1)];
  if (encoded === undefined) {
    throw new Error(`No route for operation ${name}`);
  }
  return decodeRouteCall(encoded);
}
