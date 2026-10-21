import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";

import {
  marketplaceHtmlCacheControl,
  marketplaceResponseStatus,
} from "./marketplace/marketplace-response-status.js";

import { getEnv } from "./server/env";

const fetch = createStartHandler(async (context) => {
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

export default { fetch };
