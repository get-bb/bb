import type { BoundMockHandlers } from "./handlers.js";
import type { MockRoute, MockService } from "./types.js";

interface CompiledRoute {
  readonly route: MockRoute;
  readonly pattern: RegExp;
  readonly parameterNames: readonly string[];
}

function pathSpecificity(left: CompiledRoute, right: CompiledRoute): number {
  const leftSegments = left.route.pathTemplate.split("/");
  const rightSegments = right.route.pathTemplate.split("/");
  const segmentCount = Math.max(leftSegments.length, rightSegments.length);

  for (let index = 0; index < segmentCount; index += 1) {
    const leftSegment = leftSegments[index];
    const rightSegment = rightSegments[index];
    if (leftSegment === undefined) return 1;
    if (rightSegment === undefined) return -1;
    const leftIsParameter = /^\{[^}]+\}$/.test(leftSegment);
    const rightIsParameter = /^\{[^}]+\}$/.test(rightSegment);
    if (leftIsParameter !== rightIsParameter) return leftIsParameter ? 1 : -1;
  }

  return left.route.routeId.localeCompare(right.route.routeId);
}

export interface MockRouterOptions {
  readonly service: MockService;
  readonly routes: readonly MockRoute[];
  readonly token: string;
  readonly fixtureRoot: string;
  readonly handlers: BoundMockHandlers;
}

function compileRoute(route: MockRoute): CompiledRoute {
  const parameterNames: string[] = [];
  const segments = route.pathTemplate.split("/").map((segment) => {
    const match = /^\{([^}]+)\}$/.exec(segment);
    if (match) {
      parameterNames.push(match[1]);
      return "([^/]+)";
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return {
    route,
    pattern: new RegExp(`^${segments.join("/")}/?$`),
    parameterNames,
  };
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function mediaType(contentType: string | null): string | null {
  if (contentType === null) return null;
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function paramsFor(
  compiled: CompiledRoute,
  match: RegExpExecArray,
): Readonly<Record<string, string>> {
  const params: Record<string, string> = {};
  compiled.parameterNames.forEach((name, index) => {
    params[name] = decodeURIComponent(match[index + 1]);
  });
  return params;
}

export function createMockRouter(options: MockRouterOptions) {
  const compiledRoutes = options.routes.map(compileRoute).sort(pathSpecificity);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const compiled = compiledRoutes.find(
      (candidate) =>
        candidate.route.method === request.method &&
        candidate.pattern.test(url.pathname),
    );
    if (compiled === undefined) {
      return jsonError(404, "MOCK_ROUTE_NOT_FOUND", "Mock route not found");
    }

    const authValue = request.headers.get(compiled.route.auth);
    if (authValue !== options.token) {
      return jsonError(401, "MOCK_UNAUTHORIZED", "Mock service authentication failed");
    }

    if (compiled.route.requestMediaTypes.length > 0) {
      const receivedMediaType = mediaType(request.headers.get("content-type"));
      if (
        receivedMediaType === null ||
        !compiled.route.requestMediaTypes.includes(receivedMediaType)
      ) {
        return jsonError(
          415,
          "MOCK_UNSUPPORTED_MEDIA_TYPE",
          "Request media type is not supported",
        );
      }
      if (receivedMediaType === "application/json") {
        try {
          await request.clone().json();
        } catch {
          return jsonError(400, "MOCK_INVALID_JSON", "Request JSON is invalid");
        }
      }
    }

    const handler = options.handlers.handlers.get(compiled.route.routeId);
    if (handler === undefined) {
      return jsonError(
        501,
        "MOCK_HANDLER_MISSING",
        "Mock route has no registered handler",
      );
    }
    const match = compiled.pattern.exec(url.pathname);
    if (match === null) {
      return jsonError(404, "MOCK_ROUTE_NOT_FOUND", "Mock route not found");
    }
    try {
      return await handler({
        service: options.service,
        route: compiled.route,
        request,
        params: paramsFor(compiled, match),
        fixtureRoot: options.fixtureRoot,
      });
    } catch {
      return jsonError(500, "MOCK_HANDLER_ERROR", "Mock handler failed");
    }
  };
}
