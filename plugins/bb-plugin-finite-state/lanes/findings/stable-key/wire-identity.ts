import type { Json } from "../../../lib/remote/types.js";
import { selectFindingCve, type FindingIdentityInput } from "./canonical.js";

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

export function purlIdentity(purl: string | null): {
  name: string;
  group: string | null;
  version: string | null;
} | null {
  if (purl === null || !purl.startsWith("pkg:")) return null;
  const withoutSuffix = purl.slice(4).split(/[?#]/u, 1)[0] ?? "";
  const slash = withoutSuffix.indexOf("/");
  if (slash < 0) return null;
  const segments = withoutSuffix.slice(slash + 1).split("/");
  const last = segments.pop();
  if (last === undefined || last.length === 0) return null;
  const at = last.lastIndexOf("@");
  const encodedName = at < 0 ? last : last.slice(0, at);
  const encodedVersion = at < 0 ? null : last.slice(at + 1);
  try {
    return {
      name: decodeURIComponent(encodedName),
      group:
        segments.length === 0
          ? null
          : segments.map(decodeURIComponent).join("/"),
      version:
        encodedVersion === null || encodedVersion.length === 0
          ? null
          : decodeURIComponent(encodedVersion),
    };
  } catch {
    return null;
  }
}

function wireComponentIdentity(
  row: Readonly<Record<string, Json>>,
): Omit<FindingIdentityInput, "cve"> | null {
  const component = jsonRecord(row["component"]);
  const declaredPurl = wireString(row, ["componentPurl", "purl", "packageUrl"]);
  const parsed = purlIdentity(declaredPurl);
  const name =
    wireString(row, ["componentName", "name"]) ??
    (component === null ? null : wireString(component, ["name"])) ??
    parsed?.name ??
    null;
  if (name === null) return null;
  return {
    purl: declaredPurl,
    name,
    group:
      wireString(row, ["componentGroup", "group", "namespace"]) ??
      parsed?.group ??
      null,
    version:
      wireString(row, ["componentVersion", "version"]) ??
      (component === null ? null : wireString(component, ["version"])) ??
      parsed?.version ??
      null,
  };
}

/** Derives SPEC 02 section 4.3 identity exclusively from one wire finding row. */
export function currentFindingIdentity(
  row: Readonly<Record<string, Json>>,
): FindingIdentityInput | null {
  const componentIdentity = wireComponentIdentity(row);
  const cve = selectFindingCve({
    cve: wireString(row, ["cve"]),
    findingIdentifier: wireString(row, ["findingIdentifier"]),
    findingId: wireString(row, ["findingId"]),
    vulnerabilityId: wireString(row, ["vulnerabilityId"]),
  });
  if (componentIdentity === null || cve === null) return null;
  return { ...componentIdentity, cve };
}
