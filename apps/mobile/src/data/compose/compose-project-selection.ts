import { PERSONAL_PROJECT_ID } from "@bb/domain";

/**
 * Which project the compose screen opens on: the route param, else the last
 * project composed in, else the personal project. Once the project list is
 * known, an id it does not contain falls back the same way, so a deleted
 * project never leaves the screen pointing at nothing.
 */
export interface ResolveComposeProjectIdArgs {
  requestedProjectId: string | null | undefined;
  storedProjectId: string;
  /** Ordinary project ids from the sidebar bootstrap; undefined until loaded. */
  knownProjectIds: ReadonlySet<string> | undefined;
}

export function resolveComposeProjectId({
  requestedProjectId,
  storedProjectId,
  knownProjectIds,
}: ResolveComposeProjectIdArgs): string {
  const candidates = [requestedProjectId?.trim(), storedProjectId.trim()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === PERSONAL_PROJECT_ID) return candidate;
    if (knownProjectIds === undefined || knownProjectIds.has(candidate)) {
      return candidate;
    }
  }
  return PERSONAL_PROJECT_ID;
}
