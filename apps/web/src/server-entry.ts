import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";

import { proxyPostHogRequest } from "./landing/posthog-proxy";
import { finalizeDocumentResponse } from "./server/document-response";
import {
  marketplaceHtmlCacheControl,
  marketplaceResponseStatus,
} from "./marketplace/marketplace-response-status.js";

const handleRequest = createStartHandler(async (context) => {
  const pathname = new URL(context.request.url).pathname;
  const status = marketplaceResponseStatus(
    pathname,
    context.router.state.matches.map((match) => match.loaderData),
  );
  const result = await defaultStreamHandler(context);
  const response = "response" in result ? result.response : result;
  const updatedResponse = finalizeDocumentResponse(response, {
    status,
    cacheControl: marketplaceHtmlCacheControl(
      pathname,
      status ?? response.status,
    ),
  });
  return "response" in result
    ? { ...result, response: updatedResponse }
    : updatedResponse;
});

const PROXY_CACHE = "posthog-proxy-assets";

export default {
  async fetch(
    request: Request,
    _env: unknown,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const proxied = await proxyPostHogRequest(request, {
      fetch: (input, init) => fetch(input, init),
      cache: {
        match: async (key) => (await caches.open(PROXY_CACHE)).match(key),
        put: async (key, response) =>
          (await caches.open(PROXY_CACHE)).put(key, response),
      },
      waitUntil: (promise) => ctx.waitUntil(promise),
    });
    if (proxied) return proxied;
    return handleRequest(request);
  },
};
