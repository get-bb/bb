import type {
  RouteDefinition,
  RouteOperationInput,
} from "@bb/hono-typed-routes";
import {
  isOperationBody,
  operationBodyResponse,
  type OperationBody,
  type OperationCaller,
} from "@bb/operations";
import {
  publicOperationForRoute,
  routeInputFromRequest,
  type RouteBodyOutput,
} from "@bb/server-contract";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ApiError } from "../errors.js";
import {
  operationErrorToApiError,
  type ServerKernel,
} from "./server-kernel.js";

type MaybePromise<T> = T | Promise<T>;

export interface CoreCallContext {
  caller: OperationCaller;
  signal: AbortSignal;
  request: Request | null;
}

export interface OperationRoutes {
  readonly app: Hono;
  readonly kernel: ServerKernel;
  implement<Route extends RouteDefinition>(
    route: Route,
    run: (
      input: RouteOperationInput<Route>,
      context: CoreCallContext,
    ) => MaybePromise<RouteBodyOutput<Route> | OperationBody>,
  ): void;
}

async function readFormBody(
  context: Context,
): Promise<Record<string, FormDataEntryValue | FormDataEntryValue[]>> {
  let form: FormData;
  try {
    form = await context.req.formData();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new ApiError(
      400,
      "invalid_request",
      "Request body is not valid multipart form data",
    );
  }
  const body: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const [key, value] of form.entries()) {
    const existing = body[key];
    if (existing === undefined) body[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else body[key] = [existing, value];
  }
  return body;
}

async function readRouteInput(
  context: Context,
  route: RouteDefinition,
): Promise<unknown> {
  const param = context.req.param();
  if (route.request.source === "json") {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      throw new ApiError(400, "invalid_request", "Invalid JSON request body");
    }
    return routeInputFromRequest(route, { param, body });
  }
  if (route.request.source === "query") {
    return routeInputFromRequest(route, { param, body: context.req.query() });
  }
  if (route.request.source === "form") {
    return routeInputFromRequest(route, {
      param,
      body: await readFormBody(context),
    });
  }
  return routeInputFromRequest(route, { param });
}

export function createOperationRoutes(
  app: Hono,
  serverKernel: ServerKernel,
): OperationRoutes {
  const { kernel } = serverKernel;

  function mount(route: RouteDefinition): void {
    const operation = publicOperationForRoute(route);
    const status = (operation.doors.http?.status ??
      200) as ContentfulStatusCode;
    app.on(route.method.toUpperCase(), route.path, async (context) => {
      let output: unknown;
      try {
        const raw = await readRouteInput(context, route);
        output = await kernel.call(operation, raw, {
          caller: serverKernel.callerFor(context),
          signal: context.req.raw.signal,
          http: context,
        });
      } catch (error) {
        throw operationErrorToApiError(error);
      }
      const doorHeaders = operation.doors.http?.headers ?? {};
      if (isOperationBody(output)) {
        return operationBodyResponse({
          ...output,
          headers: { ...doorHeaders, ...output.headers },
        });
      }
      for (const [name, value] of Object.entries(doorHeaders)) {
        context.header(name, value);
      }
      return context.json(output, status);
    });
  }

  return {
    app,
    kernel: serverKernel,
    implement(route, run) {
      const operation = publicOperationForRoute(route);
      kernel.implement(operation, (input, { caller, signal, http }) =>
        run(input as RouteOperationInput<typeof route>, {
          caller,
          signal,
          request: http === null ? null : http.req.raw,
        }),
      );
      mount(route);
    },
  };
}

export function assertEveryOperationImplemented(routes: OperationRoutes): void {
  const missing = routes.kernel.kernel
    .inspect()
    .filter((operation) => operation.owner === null)
    .map((operation) => operation.name);
  if (missing.length > 0) {
    throw new Error(
      `Operations without an implementation: ${missing.join(", ")}`,
    );
  }
}
