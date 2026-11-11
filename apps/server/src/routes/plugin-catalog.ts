import {
  pluginCatalogInstallRequestSchema,
  pluginMarketplaceNameSchema,
  publicApiRoutes,
} from "@bb/server-contract";
import { JsonBodyApiError } from "../errors.js";
import type { OperationRoutes } from "../kernel/http-door.js";
import type {
  PluginCatalogEntrySelector,
  PluginCatalogService,
} from "../services/plugin-catalog/plugin-catalog-service.js";
import type { PluginInstallJobs } from "../services/plugins/plugin-install-jobs.js";
import { errorMessage } from "../services/lib/error-log-fields.js";
import { hashedAssetCacheControl } from "./plugin-image-response.js";
import { respondWithInstallJob } from "./plugin-install-jobs.js";

function entrySelector(
  entryId: string | undefined,
  marketplace: string | undefined,
): PluginCatalogEntrySelector | null {
  const parsed = pluginCatalogInstallRequestSchema.safeParse({
    entryId,
    ...(marketplace === undefined ? {} : { marketplace }),
  });
  return parsed.success ? parsed.data : null;
}

export function registerPluginCatalogRoutes(
  routes: OperationRoutes,
  catalog: PluginCatalogService,
  installJobs: PluginInstallJobs,
): void {
  const catalogRoutes = publicApiRoutes.pluginCatalog;
  const marketplaceRoutes = publicApiRoutes.marketplaces;
  const failed = (error: unknown) =>
    new JsonBodyApiError(422, { error: errorMessage(error) });

  routes.implement(catalogRoutes.status, () => ({ catalog: catalog.status() }));

  routes.implement(catalogRoutes.search, async ({ q }) => ({
    results: await catalog.search(q ?? ""),
    collections: catalog.collections(),
    categories: catalog.categories(),
  }));

  routes.app.get(
    "/plugin-catalog/icons/:marketplace/:entryId",
    async (context) => {
      const icon = await catalog.icon(
        context.req.param("marketplace"),
        context.req.param("entryId"),
      );
      if (icon === undefined) {
        return context.json({ ok: false, error: "unknown catalog icon" }, 404);
      }
      return context.body(new Uint8Array(icon.bytes), 200, {
        "content-type": icon.contentType,
        "cache-control": hashedAssetCacheControl(
          context.req.query("h"),
          icon.hash,
        ),
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "x-content-type-options": "nosniff",
      });
    },
  );

  routes.implement(
    catalogRoutes.installPlan,
    async ({ entryId, marketplace }) => {
      const selector = entrySelector(entryId, marketplace);
      if (selector === null) {
        throw new JsonBodyApiError(422, {
          error: "expected ?entryId=<id>[&marketplace=<name>]",
        });
      }
      try {
        return { plan: await catalog.installPlan(selector) };
      } catch (error) {
        throw failed(error);
      }
    },
  );

  routes.implement(catalogRoutes.install, async (input, { request }) => {
    let entry: ReturnType<PluginCatalogService["describeEntry"]>;
    try {
      entry = catalog.describeEntry(input);
    } catch (error) {
      throw failed(error);
    }
    const job = installJobs.start({
      target: {
        kind: "catalog",
        entryId: entry.entryId,
        marketplace: entry.marketplace,
      },
      displayName: entry.displayName,
      run: () => catalog.install(input),
    });
    return respondWithInstallJob(request, installJobs, job, (error) => ({
      error,
    }));
  });

  routes.implement(marketplaceRoutes.list, () => ({
    marketplaces: catalog.listMarketplaces(),
  }));

  routes.implement(marketplaceRoutes.add, async ({ source, subdirectory }) => {
    try {
      return {
        ok: true as const,
        marketplace: await catalog.addMarketplace({
          source,
          subdirectory: subdirectory ?? null,
        }),
      };
    } catch (error) {
      throw failed(error);
    }
  });

  routes.implement(marketplaceRoutes.refresh, async (body) => {
    try {
      return { results: await catalog.refreshMarketplaces(body) };
    } catch (error) {
      throw failed(error);
    }
  });

  routes.implement(marketplaceRoutes.remove, async ({ name }) => {
    const parsedName = pluginMarketplaceNameSchema.safeParse(name);
    if (!parsedName.success) {
      throw new JsonBodyApiError(422, {
        error: `invalid marketplace name "${name}"`,
      });
    }
    try {
      const removed = await catalog.removeMarketplace(parsedName.data);
      return {
        ok: true as const,
        convertedPluginIds: removed.convertedPluginIds,
      };
    } catch (error) {
      throw failed(error);
    }
  });
}
