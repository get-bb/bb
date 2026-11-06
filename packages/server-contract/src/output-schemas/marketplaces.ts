import {
  pluginMarketplaceListResponseSchema,
  pluginMarketplaceMutationResponseSchema,
  pluginMarketplaceRefreshResponseSchema,
  pluginMarketplaceRemoveResponseSchema,
} from "../api/plugins.js";
import type { GroupOutputSchemas } from "../public-operations.js";

export const marketplacesOutputSchemas: GroupOutputSchemas<"marketplaces"> = {
  "marketplaces.list": pluginMarketplaceListResponseSchema,
  "marketplaces.add": pluginMarketplaceMutationResponseSchema,
  "marketplaces.refresh": pluginMarketplaceRefreshResponseSchema,
  "marketplaces.remove": pluginMarketplaceRemoveResponseSchema,
};
