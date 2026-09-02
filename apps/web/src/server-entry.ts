import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";

import { marketplaceResponseStatus } from "./marketplace/marketplace-response-status.js";

const fetch = createStartHandler((context) => {
  const status = marketplaceResponseStatus(
    new URL(context.request.url).pathname,
    context.router.state.matches.map((match) => match.loaderData),
  );
  if (status !== null) {
    context.router.stores.statusCode.set(status);
  }
  return defaultStreamHandler(context);
});

export default { fetch };
