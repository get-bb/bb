import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";

import {
  createFlagDefinitionsSource,
  type FlagDefinitionsSource,
} from "./experiments/flag-definitions";
import { NO_EXPERIMENTS, type ExperimentBootstrap } from "./experiments/flags";
import {
  resolveExperiments,
  withExperimentHeaders,
} from "./experiments/server";
import {
  marketplaceHtmlCacheControl,
  marketplaceResponseStatus,
} from "./marketplace/marketplace-response-status.js";
import { getEnv } from "./server/env";

const handleRequest = createStartHandler(async (context) => {
  const pathname = new URL(context.request.url).pathname;
  const status = marketplaceResponseStatus(
    pathname,
    context.router.state.matches.map((match) => match.loaderData),
  );
  const result = await defaultStreamHandler(context);
  const response = "response" in result ? result.response : result;
  const responseStatus = status ?? response.status;
  const cacheControl = marketplaceHtmlCacheControl(pathname, responseStatus);
  if (status === null && cacheControl === null) return result;
  const headers = new Headers(response.headers);
  if (cacheControl !== null) headers.set("cache-control", cacheControl);
  const updatedResponse = new Response(response.body, {
    status: responseStatus,
    statusText: status === null ? response.statusText : "",
    headers,
  });
  return "response" in result
    ? { ...result, response: updatedResponse }
    : updatedResponse;
});

const postHogKey: string | undefined = import.meta.env.VITE_POSTHOG_KEY;
const postHogHost: string =
  import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";
const DEFINITIONS_CACHE = "posthog-flag-definitions";
let flagDefinitions: FlagDefinitionsSource | null | undefined;

function logEntry(entry: object): void {
  console.log(JSON.stringify(entry));
}

function flagDefinitionsSource(): FlagDefinitionsSource | null {
  if (flagDefinitions === undefined) {
    const env = getEnv();
    flagDefinitions =
      postHogKey && env.POSTHOG_FLAGS_SECRET_KEY
        ? createFlagDefinitionsSource({
            host: postHogHost,
            projectKey: postHogKey,
            secretKey: env.POSTHOG_FLAGS_SECRET_KEY,
            cacheKey: `https://${env.BASE_DOMAIN}/__experiments/posthog-flag-definitions`,
            fetch: (input, init) => fetch(input, init),
            log: logEntry,
            sharedCache: {
              match: async (key) =>
                (await caches.open(DEFINITIONS_CACHE)).match(key),
              put: async (key, response) =>
                (await caches.open(DEFINITIONS_CACHE)).put(key, response),
            },
          })
        : null;
  }
  return flagDefinitions;
}

export default {
  async fetch(
    request: Request,
    _env: unknown,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const definitions = flagDefinitionsSource();
    const resolution = await resolveExperiments(request, {
      postHogKey,
      postHogHost,
      baseDomain: getEnv().BASE_DOMAIN,
      fetch: (input, init) => fetch(input, init),
      log: logEntry,
      localFlags:
        definitions === null
          ? null
          : {
              definitions,
              waitUntil: (promise) => ctx.waitUntil(promise),
            },
    });
    const response = await handleRequest(request, {
      context: { experiments: resolution?.bootstrap ?? NO_EXPERIMENTS },
    });
    return withExperimentHeaders(response, resolution);
  },
};

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { experiments: ExperimentBootstrap } };
  }
}
