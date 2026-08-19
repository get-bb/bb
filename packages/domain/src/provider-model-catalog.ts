/**
 * Whether a provider's model catalog can differ between workspaces on the same
 * machine.
 *
 * `provider.list_models` may carry a workspace path, but only the Pi bridge
 * reads it: project-level Pi configuration decides which model providers are
 * configured. The Claude Code, Codex, and ACP bridges answer `model/list` from
 * account or agent state and ignore the path, so their catalogs are host-scoped.
 * The server uses this to memoize host-scoped catalogs across environments and
 * to leave the workspace path out of the probe; the app uses it to route
 * follow-up execution-options reads by host so threads in different
 * environments share one query. Unknown (third-party) providers are treated as
 * workspace-scoped because their bridge may read the path.
 */
export function providerModelCatalogDependsOnWorkspace(
  providerId: string,
): boolean {
  if (providerId === "claude-code" || providerId === "codex") {
    return false;
  }
  if (providerId.startsWith("acp-")) {
    return false;
  }
  return true;
}
