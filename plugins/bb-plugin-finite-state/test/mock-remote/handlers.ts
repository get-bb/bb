import type {
  MockHandler,
  MockHandlerRegistry,
  MockRoute,
} from "./types.js";

export interface BoundMockHandlers {
  readonly handlers: ReadonlyMap<string, MockHandler>;
  reset(): Promise<void>;
}

export function createMockHandlerRegistry(
  callableRoutes: readonly MockRoute[],
  register?: (registry: MockHandlerRegistry) => void,
): BoundMockHandlers {
  const knownRouteIds = new Set(callableRoutes.map((route) => route.routeId));
  const handlers = new Map<string, MockHandler>();
  const resetters: (() => void | Promise<void>)[] = [];

  const registry: MockHandlerRegistry = {
    register(routeId, handler) {
      if (!knownRouteIds.has(routeId)) {
        throw new Error(`Unknown mock route registration: ${routeId}`);
      }
      if (handlers.has(routeId)) {
        throw new Error(`Duplicate mock route registration: ${routeId}`);
      }
      handlers.set(routeId, handler);
    },
    onReset(reset) {
      resetters.push(reset);
    },
  };

  register?.(registry);

  return {
    handlers,
    async reset() {
      for (const reset of resetters) await reset();
    },
  };
}
