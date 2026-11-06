import { pluginInstallResultSchema } from "../api/plugin-routes.js";
import {
  pluginCatalogInstallPlanResponseSchema,
  pluginCatalogSearchResponseSchema,
  pluginCatalogStatusResponseSchema,
} from "../api/plugins.js";
import type { GroupOutputSchemas } from "../public-operations.js";

export const pluginCatalogOutputSchemas: GroupOutputSchemas<"pluginCatalog"> = {
  "pluginCatalog.status": pluginCatalogStatusResponseSchema,
  "pluginCatalog.search": pluginCatalogSearchResponseSchema,
  "pluginCatalog.installPlan": pluginCatalogInstallPlanResponseSchema,
  "pluginCatalog.install": pluginInstallResultSchema,
};
