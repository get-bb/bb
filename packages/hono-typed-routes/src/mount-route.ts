import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import type { RouteDefinition, RouteParsedInput } from "./route-descriptor.js";
import {
  routeSuccessStatus,
  validationMessageFromZodError,
  type RouteOperationOutput,
} from "./route-operation.js";

export type RouteParsedBody<Route extends RouteDefinition> = [
  RouteParsedInput<Route["request"]>,
] extends [never]
  ? undefined
  : RouteParsedInput<Route["request"]>;

type RouteJsonOutput<Route extends RouteDefinition> =
  Route["response"] extends { format: "binary" | "text" }
    ? never
    : RouteOperationOutput<Route>;

export interface MountRouteOptions {
  invalidRequest(message: string): Error;
}

async function readParsedBody(
  context: Context,
  route: RouteDefinition,
  options: MountRouteOptions,
): Promise<unknown> {
  const request = route.request;
  if (request.source !== "json" && request.source !== "query") return undefined;
  let raw: unknown;
  if (request.source === "query") {
    raw = context.req.query();
  } else {
    try {
      raw = await context.req.json();
    } catch {
      throw options.invalidRequest("Invalid JSON request body");
    }
  }
  try {
    return request.schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      throw options.invalidRequest(validationMessageFromZodError(error));
    }
    throw error;
  }
}

export function mountRoute<Route extends RouteDefinition>(
  app: Hono<any, any, any>,
  route: Route,
  handle: (
    context: Context<{}, Route["path"]>,
    input: RouteParsedBody<Route>,
  ) =>
    | RouteJsonOutput<Route>
    | Response
    | Promise<RouteJsonOutput<Route> | Response>,
  options: MountRouteOptions,
): void {
  const status = routeSuccessStatus(route) as ContentfulStatusCode;
  app.on(route.method.toUpperCase(), route.path, async (context: Context) => {
    const input = (await readParsedBody(
      context,
      route,
      options,
    )) as RouteParsedBody<Route>;
    const output = await handle(context, input);
    if (output instanceof Response) return output;
    return context.json(output, status);
  });
}
