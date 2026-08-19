import {
  sidebarBootstrapResponseSchema,
  type SidebarBootstrapResponse,
} from "@bb/server-contract";
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
 *
 * The stored copy is bounded and written off the critical path. The live
 * response carries every unarchived thread of every project, so a large
 * profile could otherwise block the main thread serializing it right after
 * the fetch resolved, exceed the storage quota, and pay the parse again on
 * the next load. Projects are kept whole (consumers resolve the current
 * project by id from the replay) and each project's thread list is capped:
 * the first rows are the ones the rail paints first, and the rest arrive with
 * the live response.
 */
const sidebarBootstrapCache = createLastKnownCache({
  prefix: "bb.sidebar-bootstrap",
  version: "1",
  schema: sidebarBootstrapResponseSchema,
});

export const SIDEBAR_BOOTSTRAP_CACHE_KEY = sidebarBootstrapCache.key();

/** Threads kept per project in the stored replay. */
export const MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT = 30;

const SIDEBAR_BOOTSTRAP_WRITE_IDLE_TIMEOUT_MS = 5_000;
const SIDEBAR_BOOTSTRAP_WRITE_FALLBACK_DELAY_MS = 1_000;

type SidebarProject = SidebarBootstrapResponse["projects"][number];

function boundProject(project: SidebarProject): SidebarProject {
  return project.threads.length <= MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT
    ? project
    : {
        ...project,
        threads: project.threads.slice(
          0,
          MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT,
        ),
      };
}

export function boundSidebarBootstrapForCache(
  response: SidebarBootstrapResponse,
): SidebarBootstrapResponse {
  return {
    sections: response.sections,
    projects: response.projects.map(boundProject),
    personalProject: boundProject(response.personalProject),
  };
}

/**
 * The replay is read at most once per page load from storage (the parse and
 * schema validation are not free, and `placeholderData` is evaluated on every
 * render of every consumer until the live response lands); a write refreshes
 * the in-memory copy so the next read returns what was stored.
 */
let replay: SidebarBootstrapResponse | null | undefined;

export function readCachedSidebarBootstrap(): SidebarBootstrapResponse | null {
  if (replay === undefined) {
    replay = sidebarBootstrapCache.read(SIDEBAR_BOOTSTRAP_CACHE_KEY);
  }
  return replay;
}

let pendingWrite: SidebarBootstrapResponse | null = null;

function flushPendingWrite(): void {
  const value = pendingWrite;
  pendingWrite = null;
  if (value === null) return;
  // Best-effort by the cache's contract: a full store or a restricted browser
  // leaves the previous entry (or none) in place and never throws.
  sidebarBootstrapCache.write(SIDEBAR_BOOTSTRAP_CACHE_KEY, value);
}

/**
 * Remember a successful bootstrap. The bounded copy is serialized when the
 * main thread is idle (with a timeout so a busy page still persists it), not
 * inline in the query function; a newer response before the flush replaces
 * the pending one.
 */
export function writeCachedSidebarBootstrap(
  response: SidebarBootstrapResponse,
): void {
  // The write is best-effort and runs inside the query function: a
  // malformed response must fail the cache copy, never the live data path.
  let bounded: SidebarBootstrapResponse;
  try {
    bounded = boundSidebarBootstrapForCache(response);
  } catch {
    return;
  }
  replay = bounded;
  const alreadyScheduled = pendingWrite !== null;
  pendingWrite = bounded;
  if (alreadyScheduled || typeof window === "undefined") return;
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(flushPendingWrite, {
      timeout: SIDEBAR_BOOTSTRAP_WRITE_IDLE_TIMEOUT_MS,
    });
    return;
  }
  window.setTimeout(
    flushPendingWrite,
    SIDEBAR_BOOTSTRAP_WRITE_FALLBACK_DELAY_MS,
  );
}

/** Test-only. */
export function resetSidebarBootstrapCacheForTest(): void {
  replay = undefined;
  pendingWrite = null;
}
