import type { JsonValue } from "../../../shared/contract.js";
import type { FindingLocalState } from "./route.js";

export const FINDING_COLUMNS = ["state", "severity", "cve", "component", "reachability", "kev", "epss", "triage", "age"] as const;
export type FindingColumn = typeof FINDING_COLUMNS[number];

export interface FindingRow {
  stableKey: string;
  findingId: string;
  findingType: string | null;
  severity: string | null;
  cve: string | null;
  title: string | null;
  componentName: string | null;
  componentVersion: string | null;
  reachability: string | null;
  inKev: boolean;
  inVcKev: boolean;
  epss: number | null;
  triage: string | null;
  firstSeen: string | null;
  localState: FindingLocalState;
  localFile: string | null;
}

function record(value: JsonValue): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function string(value: JsonValue | undefined): string | null { return typeof value === "string" ? value : null; }
function number(value: JsonValue | undefined): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }

export function findingRow(item: { key: string; fields: Record<string, JsonValue> }): FindingRow {
  const fields = record(item.fields) ?? {};
  const local = string(fields.localState);
  return {
    stableKey: string(fields.stableKey) ?? item.key,
    findingId: item.key,
    findingType: string(fields.findingType),
    severity: string(fields.severity),
    cve: string(fields.cve),
    title: string(fields.title),
    componentName: string(fields.componentName),
    componentVersion: string(fields.componentVersion),
    reachability: string(fields.reachabilityVerdict),
    inKev: fields.inKev === true,
    inVcKev: fields.inVcKev === true,
    epss: number(fields.epssScore),
    triage: string(fields.vexStatus),
    firstSeen: string(fields.firstSeen),
    localState: local === "local" || local === "conflicted" || local === "stale" || local === "needs_completion" ? local : "none",
    localFile: string(fields.localFile),
  };
}

export function findingAge(firstSeen: string | null, now = Date.now()): string {
  if (!firstSeen) return "Unknown";
  const timestamp = Date.parse(firstSeen);
  if (!Number.isFinite(timestamp)) return "Unknown";
  const days = Math.max(0, Math.floor((now - timestamp) / 86_400_000));
  if (days < 1) return "Today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
