import type { Json, PlatformClient } from "../../../lib/remote/types.js";
import { selectFindingCve, type FindingIdentityInput } from "./canonical.js";

export interface ComponentIdentity {
  name: string;
  group: string | null;
  version: string | null;
  purl: string | null;
}

export function jsonRecord(
  value: Json | undefined,
): Record<string, Json> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

export function wireString(
  row: Readonly<Record<string, Json>>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") {
      const normalized = value.normalize("NFC").trim();
      if (normalized) return normalized;
    }
  }
  return null;
}

function componentFromRow(
  row: Readonly<Record<string, Json>>,
): ComponentIdentity | null {
  const name = wireString(row, ["name", "componentName"]);
  if (name === null) return null;
  return {
    name,
    group: wireString(row, ["group", "namespace", "componentGroup"]),
    version: wireString(row, ["version", "componentVersion"]),
    purl: wireString(row, ["purl", "packageUrl", "componentPurl"]),
  };
}

export async function loadComponentIdentities(
  platform: Pick<PlatformClient, "listComponents">,
  pageSize: number,
): Promise<Map<string, ComponentIdentity>> {
  const result = new Map<string, ComponentIdentity>();
  for await (const page of platform.listComponents({ page: { pageSize } })) {
    for (const value of page.items) {
      const row = jsonRecord(value);
      const id =
        row === null ? null : wireString(row, ["id", "componentId", "uuid"]);
      const identity = row === null ? null : componentFromRow(row);
      if (id !== null && identity !== null) result.set(id, identity);
    }
  }
  return result;
}

function joinedComponent(
  row: Readonly<Record<string, Json>>,
  identities: ReadonlyMap<string, ComponentIdentity>,
): ComponentIdentity | undefined {
  const component = jsonRecord(row["component"]);
  const componentId =
    wireString(row, ["componentId", "componentUuid"]) ??
    (component === null ? null : wireString(component, ["id"]));
  return componentId === null ? undefined : identities.get(componentId);
}

function cacheComponentIdentity(
  row: Readonly<Record<string, Json>>,
  identities: ReadonlyMap<string, ComponentIdentity>,
): Omit<FindingIdentityInput, "cve"> | null {
  const component = jsonRecord(row["component"]);
  const joined = joinedComponent(row, identities);
  const name =
    wireString(row, ["componentName", "name"]) ??
    (component === null ? null : wireString(component, ["name"])) ??
    joined?.name ??
    null;
  if (name === null) return null;
  return {
    purl:
      wireString(row, ["componentPurl", "purl", "packageUrl"]) ??
      joined?.purl ??
      null,
    name,
    group:
      wireString(row, ["componentGroup", "group", "namespace"]) ??
      joined?.group ??
      null,
    version:
      wireString(row, ["componentVersion", "version"]) ??
      (component === null ? null : wireString(component, ["version"])) ??
      joined?.version ??
      null,
  };
}

/** Reads the current canonical identity through the same aliases and index join as the cache. */
export function currentFindingIdentity(
  row: Readonly<Record<string, Json>>,
  identities: ReadonlyMap<string, ComponentIdentity>,
): FindingIdentityInput | null {
  const componentIdentity = cacheComponentIdentity(row, identities);
  const cve = selectFindingCve({
    cve: wireString(row, ["cve"]),
    findingIdentifier: wireString(row, ["findingIdentifier"]),
    findingId: wireString(row, ["findingId"]),
    vulnerabilityId: wireString(row, ["vulnerabilityId"]),
  });
  if (componentIdentity === null || cve === null) return null;
  return { ...componentIdentity, cve };
}
