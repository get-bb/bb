// Source of truth: tara_snapshot_semantic_payload(), RECON section 2.8.
// Verbatim: do not edit without re-reading the upstream migration and RECON.
export const SERVER_OWNED_BASE = [
  "id",
  "project_id",
  "organization_id",
  "org_id",
  "updated_at",
  "embedding",
  "processing_started_at",
  "processing_by",
  "source_chat_run_id",
  "needs_reanalysis",
  "stale_reason",
  "last_synced_at",
  "synced_at",
  "sync_status",
  "sync_error",
  "sbom_component_count",
  "vulnerability_count",
  "critical_vuln_count",
  "has_exploit_intel",
  "severity_order",
] as const;

export const SERVER_OWNED_DEFAULT_EXTRA = ["created_at", "processing_status"] as const;

export const SERVER_OWNED_EXTRA_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  attack_path: ["created_at", "processing_status", "route_signature"],
  source_document: ["created_at"],
};

export function serverOwnedFields(entityType: string): ReadonlySet<string> {
  const extra = SERVER_OWNED_EXTRA_BY_TYPE[entityType] ?? SERVER_OWNED_DEFAULT_EXTRA;
  return new Set([...SERVER_OWNED_BASE, ...extra]);
}

function semanticFieldName(wireField: string): string {
  return wireField
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase();
}

/**
 * Matches the frozen camelCase transport spelling against the verbatim
 * snake_case column names used by tara_snapshot_semantic_payload().
 */
export function isServerOwnedField(entityType: string, wireField: string): boolean {
  return serverOwnedFields(entityType).has(semanticFieldName(wireField));
}
