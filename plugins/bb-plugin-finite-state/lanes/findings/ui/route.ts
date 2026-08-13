export type FindingLocalState = "none" | "local" | "conflicted" | "stale" | "needs_completion";

export interface FindingsFilter {
  severity?: string[];
  reachability?: "reachable" | "unreachable" | "unknown";
  kev?: "kev" | "vc-kev" | "none";
  epssGte?: number;
  component?: string;
  cve?: string;
  triage?: string[];
  findingType?: string[];
  localState?: FindingLocalState[];
  cursor?: string;
  limit?: number;
}

export interface SavedFindingView {
  schema: "fs-findings-view/v1";
  id: string;
  name: string;
  filter: Omit<FindingsFilter, "cursor" | "limit">;
  sort: { field: string; direction: "asc" | "desc" }[];
  columns: string[];
  builtIn?: boolean;
}

export type FindingSelection =
  | { mode: "explicit"; keys: Set<string> }
  | { mode: "predicate"; filter: SavedFindingView["filter"]; excluded: Set<string>; total: number };

export interface FindingsUiState {
  route: { view?: string; stableKey?: string };
  selection: FindingSelection;
  cursorKey: string | null;
}

export type FindingsRoute =
  | { kind: "table"; filter: FindingsFilter }
  | { kind: "finding"; stableKey: string; filter: FindingsFilter }
  | { kind: "view"; view: string }
  | { kind: "policy" }
  | { kind: "import" };

const LOCAL_STATES = new Set<FindingLocalState>(["none", "local", "conflicted", "stale", "needs_completion"]);
const MAX_VALUES = 30;

function text(value: string | null | undefined, max = 512): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function many(params: URLSearchParams, key: string): string[] | undefined {
  const values = [...new Set(params.getAll(key).map(value => value.trim()).filter(Boolean))].slice(0, MAX_VALUES);
  return values.length > 0 ? values : undefined;
}

export function normalizeFindingsFilter(filter: FindingsFilter): FindingsFilter {
  const epssGte = typeof filter.epssGte === "number" && Number.isFinite(filter.epssGte)
    ? Math.min(1, Math.max(0, filter.epssGte))
    : undefined;
  const localState = filter.localState?.filter(value => LOCAL_STATES.has(value)).slice(0, 5);
  return {
    ...(filter.severity?.length ? { severity: [...new Set(filter.severity)].slice(0, MAX_VALUES) } : {}),
    ...(filter.reachability ? { reachability: filter.reachability } : {}),
    ...(filter.kev ? { kev: filter.kev } : {}),
    ...(epssGte !== undefined ? { epssGte } : {}),
    ...(text(filter.component) ? { component: text(filter.component) } : {}),
    ...(text(filter.cve) ? { cve: text(filter.cve) } : {}),
    ...(filter.triage?.length ? { triage: [...new Set(filter.triage)].slice(0, MAX_VALUES) } : {}),
    ...(filter.findingType?.length ? { findingType: [...new Set(filter.findingType)].slice(0, MAX_VALUES) } : {}),
    ...(localState?.length ? { localState } : {}),
    ...(text(filter.cursor, 4096) ? { cursor: text(filter.cursor, 4096) } : {}),
    limit: Math.min(200, Math.max(1, filter.limit ?? 100)),
  };
}

export function serializeFindingsFilter(filter: FindingsFilter): string {
  const value = normalizeFindingsFilter(filter);
  const params = new URLSearchParams();
  for (const item of value.severity ?? []) params.append("severity", item);
  if (value.reachability) params.set("reachability", value.reachability);
  if (value.kev) params.set("kev", value.kev);
  if (value.epssGte !== undefined) params.set("epss", String(value.epssGte));
  if (value.component) params.set("component", value.component);
  if (value.cve) params.set("cve", value.cve);
  for (const item of value.triage ?? []) params.append("triage", item);
  for (const item of value.findingType ?? []) params.append("type", item);
  for (const item of value.localState ?? []) params.append("local", item);
  return params.toString();
}

export function parseFindingsFilter(query: string): FindingsFilter {
  let decoded = query;
  try { decoded = decodeURIComponent(query); } catch { decoded = ""; }
  const params = new URLSearchParams(decoded);
  const reachability = params.get("reachability");
  const kev = params.get("kev");
  const epss = Number(params.get("epss"));
  const localState = many(params, "local")?.filter((value): value is FindingLocalState => LOCAL_STATES.has(value as FindingLocalState));
  return normalizeFindingsFilter({
    severity: many(params, "severity"),
    reachability: reachability === "reachable" || reachability === "unreachable" || reachability === "unknown" ? reachability : undefined,
    kev: kev === "kev" || kev === "vc-kev" || kev === "none" ? kev : undefined,
    epssGte: Number.isFinite(epss) && params.has("epss") ? epss : undefined,
    component: text(params.get("component")),
    cve: text(params.get("cve")),
    triage: many(params, "triage"),
    findingType: many(params, "type"),
    localState,
  });
}

function safeSegment(value: string | undefined): string {
  if (!value) return "";
  try { return decodeURIComponent(value); } catch { return ""; }
}

export function parseFindingsRoute(subPath: string): FindingsRoute {
  const segments = subPath.split("/").filter(Boolean);
  if (segments[0] === "f" && segments[1]) {
    return { kind: "finding", stableKey: safeSegment(segments[1]), filter: parseFindingsFilter(segments[2] ?? "") };
  }
  if (segments[0] === "view" && segments[1]) return { kind: "view", view: safeSegment(segments[1]) };
  if (segments[0] === "policy") return { kind: "policy" };
  if (segments[0] === "import") return { kind: "import" };
  if (segments[0] === "q") return { kind: "table", filter: parseFindingsFilter(segments[1] ?? "") };
  return { kind: "table", filter: normalizeFindingsFilter({}) };
}

export function findingsTableSubPath(filter: FindingsFilter): string {
  const query = serializeFindingsFilter(filter);
  return query ? `q/${query}` : "";
}

export function findingDetailSubPath(stableKey: string, filter: FindingsFilter): string {
  const query = serializeFindingsFilter(filter);
  return `f/${stableKey}${query ? `/${query}` : ""}`;
}

export function findingsViewSubPath(id: string): string { return `view/${id}`; }

export function filterSnapshot(filter: FindingsFilter): SavedFindingView["filter"] {
  const { cursor: _cursor, limit: _limit, ...snapshot } = normalizeFindingsFilter(filter);
  return snapshot;
}
