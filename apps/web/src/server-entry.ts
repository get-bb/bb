import { waitUntil } from "cloudflare:workers";
import { enrollPageRequest, finishPageRequest } from "./experiments/tracking";
import type { PageExperimentContext } from "./experiments/registry";
import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";

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
  const requestArchitecture =
    getEnv().DOWNLOAD_CLICK_CONTEXT === "true" &&
    response.headers.get("content-type")?.split(";")[0]?.trim() === "text/html";
  if (cacheControl === null && !requestArchitecture) return result;
  const headers = new Headers(response.headers);
  if (cacheControl !== null) headers.set("cache-control", cacheControl);
  if (requestArchitecture) headers.set("Accept-CH", "Sec-CH-UA-Arch");
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
  async fetch(request: Request) {
    const env = getEnv();
    const enrollment = await enrollPageRequest(
      request,
      env.PAGE_EXPERIMENTS === "true",
    );
    const pageExperiments = enrollment.assignments.length
      ? Object.fromEntries(
          enrollment.assignments.map(({ experiment, variant }) => [
            experiment.id,
            variant,
          ]),
        )
      : undefined;
    const response = await handleRequest(request, {
      context: { pageExperiments },
    });
    return finishPageRequest(
      request,
      response,
      enrollment,
      env.LANDING_POSTHOG_KEY,
      waitUntil,
    );
  },
};

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: PageExperimentContext };
  }
}
