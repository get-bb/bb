import { getDefaultProjectSource, getProjectSourceByHost } from "@bb/db";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";

export interface ResolvedHostPath {
  hostId: string;
  path: string;
}

export interface ResolveProjectSourcePathArgs {
  /**
   * Explicit host to resolve against; null = the project's default source.
   * Callers never pick a host implicitly (the `requireAutomationHostAffinity`
   * precedent).
   */
  hostId: string | null;
  projectId: string;
}

/**
 * Resolve `(hostId, path)` from a project's local-path source. Pure DB
 * lookup — never creates an environment row, never queues a provision
 * command. Use for read-only listings issued before any thread environment
 * exists (e.g. file mentions and branch listing in the new-thread prompt
 * box) and for workflow-run launch targets.
 *
 * - When `hostId` is provided, returns the project's local-path source on
 *   that host (404 if the project has no local-path source for that host).
 * - When `hostId` is null, returns the project's default local-path source
 *   (409 if the project has no default source).
 */
export function resolveProjectSourcePath(
  deps: Pick<AppDeps, "db">,
  args: ResolveProjectSourcePathArgs,
): ResolvedHostPath {
  const source = args.hostId
    ? getProjectSourceByHost(deps.db, args.projectId, args.hostId)
    : getDefaultProjectSource(deps.db, args.projectId);
  if (!source || source.type !== "local_path") {
    throw new ApiError(
      args.hostId ? 404 : 409,
      "invalid_request",
      args.hostId
        ? "Project has no local-path source for host"
        : "Project has no default source",
    );
  }
  return { hostId: source.hostId, path: source.path };
}
