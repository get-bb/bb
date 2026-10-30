import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";

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
  if (status !== null) {
    context.router.stores.statusCode.set(status);
  }
  const result = await defaultStreamHandler(context);
  const response = "response" in result ? result.response : result;
  const cacheControl = marketplaceHtmlCacheControl(pathname, response.status);
  if (cacheControl === null) return result;
  const headers = new Headers(response.headers);
  headers.set("cache-control", cacheControl);
  const updatedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  return "response" in result
    ? { ...result, response: updatedResponse }
    : updatedResponse;
});

export default {
  async fetch(request: Request): Promise<Response> {
    const resolution = await resolveExperiments(request, {
      postHogKey: import.meta.env.VITE_POSTHOG_KEY,
      postHogHost:
        import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com",
      baseDomain: getEnv().BASE_DOMAIN,
      fetch: (input, init) => fetch(input, init),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
    const response = await handleRequest(request, {
      context: { experiments: resolution?.bootstrap ?? NO_EXPERIMENTS },
    });
    return resolution === null
      ? response
      : withExperimentHeaders(response, resolution);
  },
};

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { experiments: ExperimentBootstrap } };
  }
}
