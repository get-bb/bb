import { createServerFn } from "@tanstack/react-start";

import { getEnv } from "../server/env.js";
import { serveMarketplaceObject } from "../server/marketplace.js";
import {
  loadPublicMarketplace,
  type PublicMarketplaceData,
} from "./marketplace-data.js";

async function marketplaceJson(path: string): Promise<unknown> {
  const response = await serveMarketplaceObject({
    bucket: getEnv().MARKETPLACE,
    request: new Request(`https://getbb.app${path}`),
  });
  if (!response.ok) {
    throw new Error(`Marketplace resource unavailable: ${response.status}`);
  }
  return response.json();
}

export const getPublicMarketplace = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicMarketplaceData> =>
    loadPublicMarketplace(marketplaceJson),
);
