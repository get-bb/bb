import {
  findingStableKey,
  type FindingKeyTier,
} from "../../../lib/sync/registry.js";

const CVE = /^CVE-\d{4}-\d+$/u;

export interface FindingIdentityInput {
  cve: string;
  purl: string | null;
  name: string;
  group: string | null;
  version: string | null;
}

export interface CanonicalFindingIdentity extends FindingIdentityInput {
  tier: FindingKeyTier;
  /** Undecoded wire value used only for collision-free key derivation. */
  keyVersion: string | null;
}

/** Selects a CVE without allowing an opaque vulnerability UUID to outrank findingId. */
export function selectFindingCve(
  fields: Readonly<{
    cve: string | null;
    findingIdentifier: string | null;
    findingId: string | null;
    vulnerabilityId: string | null;
  }>,
): string | null {
  const declared = [
    fields.cve,
    fields.findingIdentifier,
    fields.findingId,
  ].find((value): value is string => value !== null && CVE.test(value));
  return (
    declared ??
    fields.cve ??
    fields.findingIdentifier ??
    fields.findingId ??
    fields.vulnerabilityId
  );
}

function decodeWireVersion(version: string): string {
  try {
    return decodeURIComponent(version);
  } catch {
    // Platform data also contains literal percent signs. Preserve malformed
    // encodings for display instead of making an unrelated row unpullable.
    return version;
  }
}

function canonicalNamespace(
  group: string | null,
  name: string,
): {
  group: string | null;
  name: string;
} {
  let decodedGroup = group;
  if (group !== null) {
    try {
      decodedGroup = decodeURIComponent(group);
    } catch {
      // Preserve malformed wire values. Encoding below makes the result
      // canonical and a subsequent pass decodes it back to the same value.
    }
  }
  const segments = [
    ...(decodedGroup === null ? [] : decodedGroup.split("/")),
    ...name.split("/"),
  ]
    .map((segment) => segment.normalize("NFC").trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return { group: null, name };
  const leaf = segments.at(-1) ?? name;
  const namespace = segments.slice(0, -1).map(encodeURIComponent).join("%2F");
  return { group: namespace || null, name: leaf };
}

/**
 * Canonicalizes raw Platform component identity without consulting the
 * portfolio-wide component index. The untouched wire record remains in the
 * findings cache's raw column for push and diff surfaces.
 */
export function canonicalizeFindingIdentity(
  input: FindingIdentityInput,
): CanonicalFindingIdentity {
  const namespace =
    input.purl === null
      ? canonicalNamespace(input.group, input.name)
      : { group: input.group, name: input.name };
  const keyVersion = input.version;
  const version =
    input.version === null ? null : decodeWireVersion(input.version);
  const tier: FindingKeyTier =
    input.purl !== null
      ? "purl"
      : version !== null
        ? "name-group-version"
        : "name-group-any-version";
  return { ...input, ...namespace, version, keyVersion, tier };
}

export function canonicalFindingStableKey(
  identity: CanonicalFindingIdentity,
): string {
  return findingStableKey(
    {
      cve: identity.cve,
      purl: identity.purl,
      name: identity.name,
      group: identity.group,
      version: identity.keyVersion,
    },
    identity.tier,
  );
}

export function legacyFindingStableKey(
  identity: FindingIdentityInput,
): string | null {
  const tier: FindingKeyTier =
    identity.purl !== null
      ? "purl"
      : identity.version !== null
        ? "name-group-version"
        : "name-group-any-version";
  try {
    return findingStableKey(
      {
        cve: identity.cve,
        purl: identity.purl,
        name: identity.name,
        group: identity.group,
        version: identity.version,
      },
      tier,
    );
  } catch {
    return null;
  }
}
