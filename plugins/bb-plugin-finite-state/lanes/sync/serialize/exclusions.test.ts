import { describe, expect, it } from "vitest";

import {
  SERVER_OWNED_BASE,
  SERVER_OWNED_DEFAULT_EXTRA,
  SERVER_OWNED_EXTRA_BY_TYPE,
  isServerOwnedField,
  serverOwnedFields,
} from "./exclusions.js";

describe("server-owned field exclusions", () => {
  it("matches the RECON 2.8 base list verbatim", () => {
    expect(SERVER_OWNED_BASE).toEqual([
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
    ]);
    expect(SERVER_OWNED_BASE).toHaveLength(20);
    expect(SERVER_OWNED_DEFAULT_EXTRA).toEqual(["created_at", "processing_status"]);
    expect(SERVER_OWNED_EXTRA_BY_TYPE).toEqual({
      attack_path: ["created_at", "processing_status", "route_signature"],
      source_document: ["created_at"],
    });
  });

  it("adds route_signature for attack_path", () => {
    expect([...serverOwnedFields("attack_path")]).toEqual([
      ...SERVER_OWNED_BASE,
      "created_at",
      "processing_status",
      "route_signature",
    ]);
  });

  it("keeps processing_status for source_document", () => {
    const fields = serverOwnedFields("source_document");

    expect(fields.has("created_at")).toBe(true);
    expect(fields.has("processing_status")).toBe(false);
  });

  it("uses the default extras for an unknown entity type", () => {
    expect([...serverOwnedFields("future_entity")]).toEqual([
      ...SERVER_OWNED_BASE,
      "created_at",
      "processing_status",
    ]);
  });

  it("matches frozen camelCase wire fields without changing the upstream list", () => {
    expect(isServerOwnedField("component", "projectId")).toBe(true);
    expect(isServerOwnedField("component", "updatedAt")).toBe(true);
    expect(isServerOwnedField("component", "syncStatus")).toBe(true);
    expect(isServerOwnedField("attack_path", "routeSignature")).toBe(true);
    expect(isServerOwnedField("source_document", "processingStatus")).toBe(false);
    expect(isServerOwnedField("component", "futureSemanticField")).toBe(false);
  });
});
