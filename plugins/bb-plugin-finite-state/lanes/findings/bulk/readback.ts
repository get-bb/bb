import {
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_STATUSES,
  type Json,
  type PlatformClient,
  type VexJustification,
  type VexResponse,
  type VexStatus,
} from "../../../lib/remote/types.js";
import { findingStableKey, parseFindingStableKey, type FindingIdentity } from "../../../lib/sync/registry.js";
import { canonicalJson } from "../../sync/serialize/canonical.js";
import type { VexTuple } from "../overlay/schema.js";

const VEX_REASON_MAX_LENGTH = 10_000;
const VEX_READ_PAGE_SIZE = 1_000;
const VEX_TARGETED_READ_LIMIT = 1_000;
const PROVENANCE_PREFIX = /^\[bb:[A-Za-z0-9][A-Za-z0-9._-]{0,127}\](?: |$)/u;

function optionalString(value: Json | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function purlIdentity(purl: string): Pick<FindingIdentity, "name" | "group" | "version"> | null {
  if (!purl.startsWith("pkg:")) return null;
  const withoutSuffix = purl.slice(4).split(/[?#]/u, 1)[0] ?? "";
  const slash = withoutSuffix.indexOf("/");
  if (slash < 0) return null;
  const segments = withoutSuffix.slice(slash + 1).split("/");
  const last = segments.pop();
  if (last === undefined || last.length === 0) return null;
  const at = last.lastIndexOf("@");
  const name = decode(at < 0 ? last : last.slice(0, at));
  const version = at < 0 ? null : decode(last.slice(at + 1));
  const groupSegments = segments.map(decode);
  if (name === null || groupSegments.some((segment) => segment === null)) return null;
  return {
    name,
    group: groupSegments.length === 0 ? null : groupSegments.join("/"),
    version: version === "" ? null : version,
  };
}

export function identityFromStableKey(project: string, stableKey: string): {
  project: string;
  identity: FindingIdentity;
  tier: ReturnType<typeof parseFindingStableKey>["tier"];
} {
  const parsed = parseFindingStableKey(stableKey);
  if ("purl" in parsed.component) {
    const identity = purlIdentity(parsed.component.purl);
    if (identity === null) throw new Error("VEX purl stable key cannot provide fallback identity");
    return {
      project,
      tier: parsed.tier,
      identity: { cve: parsed.cve, purl: parsed.component.purl, ...identity },
    };
  }
  return {
    project,
    tier: parsed.tier,
    identity: {
      cve: parsed.cve,
      purl: null,
      name: parsed.component.name,
      group: parsed.component.group,
      version: parsed.component.version,
    },
  };
}

function remoteIdentity(detail: Readonly<Record<string, Json>>): FindingIdentity | null {
  const cve = optionalString(detail["cve"]);
  const purl = optionalString(detail["componentPurl"]);
  const parsed = purl === null ? null : purlIdentity(purl);
  const fallback = optionalString(detail["componentFallbackIdentity"])
    ?? optionalString(detail["componentId"])
    ?? optionalString(detail["componentName"]);
  const name = parsed?.name ?? fallback;
  if (cve === null || name === null) return null;
  return {
    cve,
    purl,
    name,
    group: parsed?.group ?? optionalString(detail["componentGroup"]),
    version: parsed?.version ?? optionalString(detail["componentVersion"]),
  };
}

export function detailMatchesStableKey(
  detail: Readonly<Record<string, Json>>,
  stableKey: string,
): boolean {
  const parsed = parseFindingStableKey(stableKey);
  const identity = remoteIdentity(detail);
  if (identity === null) return false;
  try {
    return findingStableKey({
      cve: identity.cve,
      purl: identity.purl,
      name: identity.name,
      group: identity.group,
      version: identity.version,
    }, parsed.tier) === stableKey;
  } catch {
    return false;
  }
}

export function stripVexProvenance(reason: string | null): string | null {
  if (reason === null) return null;
  const stripped = reason.replace(PROVENANCE_PREFIX, "");
  return stripped.length === 0 ? null : stripped;
}

export function stampVexReason(runId: string, reason: string | null): string {
  const prefix = `[bb:${runId}]`;
  const stamped = reason === null || reason.length === 0 ? prefix : `${prefix} ${reason}`;
  if (stamped.length > VEX_REASON_MAX_LENGTH) {
    throw new Error("VEX reason plus required provenance exceeds the verified 10,000-character authored boundary");
  }
  return stamped;
}

export function tupleFromDetail(detail: Readonly<Record<string, Json>>): VexTuple | null {
  const status = optionalString(detail["vexStatus"]);
  const response = optionalString(detail["vexResponse"]);
  const justification = optionalString(detail["vexJustification"]);
  const reason = stripVexProvenance(optionalString(detail["vexReason"]));
  if (status === null && response === null && justification === null && reason === null) return null;
  const vexStatus = VEX_STATUSES.find((candidate): candidate is VexStatus => candidate === status) ?? null;
  const vexResponse = VEX_RESPONSES.find((candidate): candidate is VexResponse => candidate === response) ?? null;
  const vexJustification = VEX_JUSTIFICATIONS.find(
    (candidate): candidate is VexJustification => candidate === justification,
  ) ?? null;
  if (
    (status !== null && vexStatus === null)
    || (response !== null && vexResponse === null)
    || (justification !== null && vexJustification === null)
  ) {
    throw new Error("Platform returned a VEX tuple outside the frozen vocabulary");
  }
  return {
    status: vexStatus,
    response: vexResponse,
    justification: vexJustification,
    reason,
  };
}

export function sameVexTuple(left: VexTuple | null, right: VexTuple | null): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export async function getTargetDetails(
  platform: Pick<PlatformClient, "getFindingDetail" | "getFindings">,
  pvId: string,
  findingIds: ReadonlySet<string>,
  signal?: AbortSignal,
  onPage?: (matched: number) => void,
): Promise<Map<string, Record<string, Json>>> {
  const details = new Map<string, Record<string, Json>>();
  if (findingIds.size === 0) return details;
  if (findingIds.size <= VEX_TARGETED_READ_LIMIT) {
    await Promise.all([...findingIds].map(async (findingId) => {
      const detail = await platform.getFindingDetail({ projectVersionId: pvId, findingId }, { signal });
      details.set(findingId, detail);
      onPage?.(1);
    }));
    return details;
  }
  for await (const page of platform.getFindings({
    projectVersionId: pvId,
    page: { pageSize: VEX_READ_PAGE_SIZE },
  }, { signal })) {
    let matched = 0;
    for (const detail of page.items) {
      const findingId = detail["id"];
      if (typeof findingId !== "string" || !findingIds.has(findingId)) continue;
      if (details.has(findingId)) throw new Error(`Platform returned duplicate finding ${findingId}`);
      details.set(findingId, detail);
      matched += 1;
    }
    onPage?.(matched);
    if (details.size === findingIds.size) break;
  }
  return details;
}
