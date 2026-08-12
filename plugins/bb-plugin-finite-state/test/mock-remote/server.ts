import { createServer, type Server } from "node:http";

import {
  ASSURANCE_STUDIO_REFERENCE_ROUTES,
  ASSURANCE_STUDIO_ROUTES,
} from "./generated/assurance-studio-routes.js";
import {
  PLATFORM_REFERENCE_ROUTES,
  PLATFORM_ROUTES,
} from "./generated/platform-routes.js";
import { createMockHandlerRegistry } from "./handlers.js";
import { createMockRouter } from "./router.js";
import {
  loopbackBaseUrl,
  type MockRemoteHarness,
  type MockRemoteOptions,
  type MockService,
  type MockServiceServer,
} from "./types.js";

interface ServiceOptions {
  readonly service: MockService;
  readonly token: string;
  readonly fixtureRoot: string;
  readonly register: MockRemoteOptions["register"];
}

function nodeRequestUrl(request: import("node:http").IncomingMessage): string {
  const authority = request.headers.host ?? "127.0.0.1";
  return `http://${authority}${request.url ?? "/"}`;
}

function createService(options: ServiceOptions): MockServiceServer {
  const referenceRoutes =
    options.service === "platform"
      ? PLATFORM_REFERENCE_ROUTES
      : ASSURANCE_STUDIO_REFERENCE_ROUTES;
  const callableRoutes =
    options.service === "platform" ? PLATFORM_ROUTES : ASSURANCE_STUDIO_ROUTES;
  const boundHandlers = createMockHandlerRegistry(callableRoutes, (registry) =>
    options.register?.(options.service, registry),
  );
  const route = createMockRouter({
    service: options.service,
    routes: referenceRoutes,
    token: options.token,
    fixtureRoot: options.fixtureRoot,
    handlers: boundHandlers,
  });
  let server: Server | null = null;
  let baseUrl: string | null = null;

  return {
    service: options.service,
    routes: callableRoutes,
    async fetch(input, init) {
      const request = new Request(input, init);
      return route(request);
    },
    async listen() {
      if (baseUrl !== null) return baseUrl;
      const nextServer = createServer(async (incoming, outgoing) => {
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
            else headers.set(name, value);
          }
          const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
          let body: string | undefined;
          if (hasBody) {
            const chunks: Uint8Array[] = [];
            for await (const chunk of incoming) {
              chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
            }
            body = Buffer.concat(chunks).toString("utf8");
          }
          const request = new Request(nodeRequestUrl(incoming), {
            method: incoming.method,
            headers,
            ...(hasBody ? { body } : {}),
          });
          const response = await route(request);
          outgoing.statusCode = response.status;
          response.headers.forEach((value, name) => outgoing.setHeader(name, value));
          if (response.body === null) outgoing.end();
          else outgoing.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          outgoing.statusCode = 500;
          outgoing.setHeader("content-type", "application/json");
          outgoing.end(
            JSON.stringify({
              error: { code: "MOCK_SERVER_ERROR", message: "Mock server failed" },
            }),
          );
        }
      });
      await new Promise<void>((resolveListen, reject) => {
        nextServer.once("error", reject);
        nextServer.listen(0, "127.0.0.1", () => {
          nextServer.off("error", reject);
          resolveListen();
        });
      });
      const address = nextServer.address();
      if (address === null || typeof address === "string") {
        await new Promise<void>((resolveClose) => nextServer.close(() => resolveClose()));
        throw new Error(`Mock ${options.service} server did not receive an address`);
      }
      server = nextServer;
      baseUrl = loopbackBaseUrl(address);
      return baseUrl;
    },
    reset() {
      return boundHandlers.reset();
    },
    async close() {
      const current = server;
      server = null;
      baseUrl = null;
      if (current === null) return;
      current.closeAllConnections();
      await new Promise<void>((resolveClose, reject) => {
        current.close((error) => (error ? reject(error) : resolveClose()));
      });
    },
  };
}

export function createMockRemote(options: MockRemoteOptions): MockRemoteHarness {
  const platform = createService({
    service: "platform",
    token: options.platformToken,
    fixtureRoot: options.fixtureRoot,
    register: options.register,
  });
  const assuranceStudio = createService({
    service: "assurance-studio",
    token: options.assuranceStudioKey,
    fixtureRoot: options.fixtureRoot,
    register: options.register,
  });
  return {
    platform,
    assuranceStudio,
    async listen() {
      const [platformBaseUrl, assuranceStudioBaseUrl] = await Promise.all([
        platform.listen(),
        assuranceStudio.listen(),
      ]);
      return { platformBaseUrl, assuranceStudioBaseUrl };
    },
    async reset(service) {
      if (service === "platform") return platform.reset();
      if (service === "assurance-studio") return assuranceStudio.reset();
      await Promise.all([platform.reset(), assuranceStudio.reset()]);
    },
    async close() {
      await Promise.all([platform.close(), assuranceStudio.close()]);
    },
  };
}

export type {
  MockHandler,
  MockHandlerContext,
  MockHandlerRegistry,
  MockRemoteHarness,
  MockRemoteOptions,
  MockRoute,
  MockService,
  MockServiceServer,
} from "./types.js";
