import type { ProviderModelCatalogScope } from "./provider-types.js";

/**
 * Whether a provider's model catalog can differ between workspaces on the same
 * machine.
 *
 * `provider.list_models` may carry a workspace path, and whether the bridge
 * reads it is the provider's own fact: project-level Pi configuration decides
 * which model providers are configured, while the Claude Code, Codex and ACP
 * bridges answer from account or agent state and ignore the path. The plugin
 * declares which it is (`models.scope`); core never infers it
 * from an id. The server uses this to memoize host-scoped catalogs across
 * environments and to leave the workspace path out of the probe; the app uses
 * it to route follow-up execution-options reads by host so threads in
 * different environments share one query.
 *
 * A provider bb cannot resolve — no registration, or a caller that has only an
 * id — is treated as workspace-scoped, which can only cost a redundant probe.
 */
export function providerModelCatalogDependsOnWorkspace(
  scope: ProviderModelCatalogScope | undefined,
): boolean {
  return scope !== "host";
}
