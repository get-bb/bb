import { sidebarBootstrapResponseSchema } from "@bb/server-contract";
import { createLastKnownCache } from "@/lib/last-known-cache";

/**
 * The last sidebar bootstrap this profile received: sections, projects with
 * their thread lists, and the personal project. Replayed as placeholder data
 * on the next full load so the sidebar (and every surface that reads project
 * names from the shared cache) paints the rail this browser last saw instead
 * of a loading skeleton the real rows then replace. One entry per origin: the
 * endpoint has no routing dimensions.
 *
 * Provisional like every last-known value: rows are navigation, so a stale
 * row degrades to an in-page load failure at worst, and the live response
 * replaces the replay in place when it lands.
 */
const sidebarBootstrapCache = createLastKnownCache({
  prefix: "bb.sidebar-bootstrap",
  version: "1",
  schema: sidebarBootstrapResponseSchema,
});

export const SIDEBAR_BOOTSTRAP_CACHE_KEY = sidebarBootstrapCache.key();

export const readCachedSidebarBootstrap = sidebarBootstrapCache.read;
export const writeCachedSidebarBootstrap = sidebarBootstrapCache.write;
