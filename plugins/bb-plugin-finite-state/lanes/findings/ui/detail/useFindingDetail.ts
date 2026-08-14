import { useCallback, useEffect, useMemo, useState } from "react";
import {
  experimental_useSidebarThreads,
  useBbContext,
  useRpc,
} from "@bb/plugin-sdk/app";
import type { z } from "zod";
import type { JsonValue } from "../../../../shared/contract.js";
import type { findingsUiRpcContract } from "../../rpc.js";

type DetailResult = z.output<
  (typeof findingsUiRpcContract)["findingDetailGet"]["output"]
>;

export interface EvidenceFactor {
  label: string;
  value: string;
  source: string | null;
}

export interface VexTuple {
  status: string | null;
  response: string | null;
  justification: string | null;
  reason: string | null;
}

export interface FindingCommentSummary {
  id: string;
  findingId: string;
  actorLabel: string | null;
  text: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface FindingDetailRow {
  projectId: string;
  projectVersionId: string;
  findingId: string;
  stableKey: string;
  cve: string | null;
  title: string | null;
  findingType: string | null;
  componentName: string | null;
  componentGroup: string | null;
  componentVersion: string | null;
  componentPurl: string | null;
  componentSlug: string | null;
  severity: string | null;
  cvss: number | null;
  cvssVector: string | null;
  epss: number | null;
  epssPercentile: number | null;
  kev: boolean;
  vcKev: boolean;
  hasExploit: boolean;
  exploitMaturity: string | null;
  reachabilityVerdict: "reachable" | "unreachable" | "unknown";
  reachabilityFactors: EvidenceFactor[];
  location: JsonValue;
  warningCount: number | null;
  violationCount: number | null;
  serverVex: VexTuple | null;
  localVex: VexTuple | null;
  localState: "none" | "local" | "conflicted" | "stale" | "needs_completion";
  localFile: string | null;
  remediation: string | null;
  commentCount: number;
  pulledAt: string;
}

export interface FindingDetailModel {
  stableKey: string;
  resolution: { tier: 1 | 2 | 3; duplicateCount: number };
  rows: FindingDetailRow[];
  effective: {
    severity: string;
    cvss?: number;
    epss?: number;
    kev: boolean;
    vcKev: boolean;
  };
  reachability: {
    verdict: "reachable" | "unreachable" | "unknown";
    factors: EvidenceFactor[];
  };
  vex: { server: VexTuple | null; local: VexTuple | null; state: string };
  comments: {
    items: FindingCommentSummary[];
    total: number;
    cursor: string | null;
    versionSpecific: true;
  };
  links: Array<{
    kind: "firmware" | "sbom" | "tara" | "requirement" | "verification";
    target: string;
    ready: boolean;
    reason?: string;
  }>;
  cache: { pulledAt: string; stale: boolean };
}

export type FindingDetailState =
  | {
      status: "invalid" | "unconfigured" | "loading";
      data: null;
      error: null;
      retry(): void;
    }
  | { status: "empty"; data: null; error: string | null; retry(): void }
  | {
      status: "error";
      data: FindingDetailModel | null;
      error: string;
      retry(): void;
    }
  | {
      status: "ready";
      data: FindingDetailModel;
      error: string | null;
      retry(): void;
    };

const BASE64URL = /^[A-Za-z0-9_-]+$/u;

function decodeSegment(segment: string): string | null {
  if (!BASE64URL.test(segment)) return null;
  try {
    const padded = `${segment.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - (segment.length % 4)) % 4)}`;
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let canonical = "";
    for (const byte of new TextEncoder().encode(decoded))
      canonical += String.fromCharCode(byte);
    if (
      btoa(canonical)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/u, "") !== segment
    )
      return null;
    return decoded === decoded.normalize("NFC") ? decoded : null;
  } catch {
    return null;
  }
}

/** Fast browser guard; the server repeats validation with the frozen codec. */
export function validateFindingStableKey(value: string): boolean {
  if (value.length === 0 || value.length > 512 || value !== value.trim())
    return false;
  const parts = value.split(".");
  if (parts[0] !== "fs1" || parts.slice(1).some((part) => part.length === 0))
    return false;
  const decoded = parts.slice(1).map(decodeSegment);
  if (decoded.some((segment) => segment === null)) return false;
  const [kind, tier, cve, ...component] = decoded;
  if (kind !== "finding" || !cve) return false;
  return (
    (tier === "purl" && component.length === 1 && Boolean(component[0])) ||
    (tier === "name-group-version" &&
      component.length === 3 &&
      Boolean(component[0]) &&
      Boolean(component[2])) ||
    (tier === "name-group-any-version" &&
      component.length === 2 &&
      Boolean(component[0]))
  );
}

function record(
  value: JsonValue | undefined,
): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function text(fields: Record<string, JsonValue>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" ? value : null;
}

function number(fields: Record<string, JsonValue>, key: string): number | null {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tuple(
  fields: Record<string, JsonValue>,
  prefix: "" | "local",
): VexTuple | null {
  const key = (name: string) =>
    prefix
      ? `localVex${name[0]?.toUpperCase()}${name.slice(1)}`
      : `vex${name[0]?.toUpperCase()}${name.slice(1)}`;
  const result: VexTuple = {
    status: text(fields, key("status")),
    response: text(fields, key("response")),
    justification: text(fields, key("justification")),
    reason: text(fields, key("reason")),
  };
  return Object.values(result).every((value) => value === null) ? null : result;
}

function evidenceFactors(value: JsonValue | undefined): EvidenceFactor[] {
  if (!Array.isArray(value)) return [];
  const result: EvidenceFactor[] = [];
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate === "string" && candidate.trim()) {
      result.push({
        label: `Factor ${index + 1}`,
        value: candidate,
        source: null,
      });
      continue;
    }
    const item = record(candidate);
    if (!item) continue;
    const label = ["label", "name", "factor", "type"]
      .map((key) => text(item, key))
      .find(Boolean);
    const rawValue = ["value", "result", "verdict", "evidence"]
      .map((key) => item[key])
      .find((value) => value !== undefined);
    if (!label || rawValue === undefined) continue;
    result.push({
      label,
      value: typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue),
      source: text(item, "source"),
    });
  }
  return result;
}

function verdict(
  value: string | null,
  factors: readonly EvidenceFactor[],
): FindingDetailRow["reachabilityVerdict"] {
  if (factors.length === 0) return "unknown";
  return value === "reachable" || value === "unreachable" ? value : "unknown";
}

function rowFromResult(result: DetailResult["rows"][number]): FindingDetailRow {
  const fields = result.fields;
  const factors = evidenceFactors(fields["reachabilityFactors"]);
  const state = text(fields, "localState");
  return {
    projectId: result.projectId,
    projectVersionId: result.projectVersionId ?? "",
    findingId: result.key,
    stableKey: text(fields, "stableKey") ?? "",
    cve: text(fields, "cve"),
    title: text(fields, "title"),
    findingType: text(fields, "findingType"),
    componentName: text(fields, "componentName"),
    componentGroup: text(fields, "componentGroup"),
    componentVersion: text(fields, "componentVersion"),
    componentPurl: text(fields, "componentPurl"),
    componentSlug: text(fields, "componentSlug"),
    severity: text(fields, "severity"),
    cvss: number(fields, "cvssScore"),
    cvssVector: text(fields, "cvssVector"),
    epss: number(fields, "epssScore"),
    epssPercentile: number(fields, "epssPercentile"),
    kev: fields["inKev"] === true,
    vcKev: fields["inVcKev"] === true,
    hasExploit: fields["hasExploit"] === true,
    exploitMaturity: text(fields, "exploitMaturity"),
    reachabilityVerdict: verdict(text(fields, "reachabilityVerdict"), factors),
    reachabilityFactors: factors,
    location: fields["location"] ?? null,
    warningCount: number(fields, "warningCount"),
    violationCount: number(fields, "violationCount"),
    serverVex: tuple(fields, ""),
    localVex: tuple(fields, "local"),
    localState:
      state === "local" ||
      state === "conflicted" ||
      state === "stale" ||
      state === "needs_completion"
        ? state
        : "none",
    localFile: text(fields, "localFile"),
    remediation: text(fields, "remediation"),
    commentCount: number(fields, "commentCount") ?? 0,
    pulledAt: text(fields, "pulledAt") ?? result.cache.asOf ?? "",
  };
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

function consensusTuple(
  rows: readonly FindingDetailRow[],
  key: "serverVex" | "localVex",
): VexTuple | null {
  const values = rows
    .map((row) => row[key])
    .filter((value): value is VexTuple => value !== null);
  if (values.length === 0) return null;
  const first = JSON.stringify(values[0]);
  return values.every((value) => JSON.stringify(value) === first)
    ? (values[0] ?? null)
    : null;
}

function modelFromResult(
  stableKey: string,
  result: DetailResult,
): FindingDetailModel | null {
  if (
    result.state !== "resolved" ||
    result.tier === null ||
    result.rows.length === 0
  )
    return null;
  const rows = result.rows.map(rowFromResult);
  const factors = rows
    .flatMap((row) => row.reachabilityFactors)
    .filter(
      (factor, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.label === factor.label &&
            candidate.value === factor.value &&
            candidate.source === factor.source,
        ) === index,
    );
  const verdicts = new Set(rows.map((row) => row.reachabilityVerdict));
  const combinedVerdict =
    factors.length > 0 && verdicts.size === 1
      ? (rows[0]?.reachabilityVerdict ?? "unknown")
      : "unknown";
  const severity =
    rows
      .map((row) => row.severity?.toLowerCase() ?? "unknown")
      .sort(
        (left, right) =>
          (SEVERITY_RANK[right] ?? 0) - (SEVERITY_RANK[left] ?? 0),
      )[0] ?? "unknown";
  const cvssValues = rows.flatMap((row) =>
    row.cvss === null ? [] : [row.cvss],
  );
  const epssValues = rows.flatMap((row) =>
    row.epss === null ? [] : [row.epss],
  );
  const server = consensusTuple(rows, "serverVex");
  const local = consensusTuple(rows, "localVex");
  const states = new Set(rows.map((row) => row.localState));
  const vexState =
    states.has("conflicted") ||
    (server && local && JSON.stringify(server) !== JSON.stringify(local))
      ? "conflict"
      : local
        ? "local_override"
        : server
          ? "server"
          : "undecided";
  return {
    stableKey,
    resolution: { tier: result.tier, duplicateCount: rows.length },
    rows,
    effective: {
      severity,
      ...(cvssValues.length > 0 ? { cvss: Math.max(...cvssValues) } : {}),
      ...(epssValues.length > 0 ? { epss: Math.max(...epssValues) } : {}),
      kev: rows.some((row) => row.kev),
      vcKev: rows.some((row) => row.vcKev),
    },
    reachability: { verdict: combinedVerdict, factors },
    vex: { server, local, state: vexState },
    comments: {
      items: [],
      total: rows.reduce((total, row) => total + row.commentCount, 0),
      cursor: null,
      versionSpecific: true,
    },
    links: [],
    cache: {
      pulledAt: result.cache.asOf ?? rows[0]?.pulledAt ?? "",
      stale: result.cache.state === "stale",
    },
  };
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message.slice(0, 300)
    : "Finding detail could not be loaded.";
}

export function useFindingDetail(stableKey: string): FindingDetailState {
  const context = useBbContext();
  const sidebar = experimental_useSidebarThreads();
  const rpc = useRpc<typeof findingsUiRpcContract>();
  const projectId =
    context.projectId ??
    (sidebar.status === "ready" ? (sidebar.projects[0]?.id ?? null) : null);
  const valid = useMemo(() => validateFindingStableKey(stableKey), [stableKey]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<FindingDetailState, "retry">>(() =>
    !valid
      ? { status: "invalid", data: null, error: null }
      : !projectId
        ? { status: "unconfigured", data: null, error: null }
        : { status: "loading", data: null, error: null },
  );
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (!valid || !projectId) return;
    let active = true;
    setState({ status: "loading", data: null, error: null });
    void rpc
      .call("cachedProjectVersions", { projectId })
      .then((versions) => {
        if (!active) return null;
        const scope =
          versions.versions.find(
            (version) =>
              version.platformProjectId ===
                versions.selectedPlatformProjectId &&
              version.projectVersionId === versions.selectedProjectVersionId,
          ) ?? versions.versions[0];
        if (!scope) {
          setState({ status: "unconfigured", data: null, error: null });
          return null;
        }
        return rpc.call("findingDetailGet", {
          projectId: scope.platformProjectId,
          projectVersionId: scope.projectVersionId,
          stableKey,
        });
      })
      .then((result) => {
        if (!active || !result) return;
        const data = modelFromResult(stableKey, result);
        if (!data) {
          setState({
            status: "empty",
            data: null,
            error:
              result.state === "stale"
                ? "The exact component version changed; refresh the findings route from the table."
                : null,
          });
          return;
        }
        setState({ status: "ready", data, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = safeError(error);
        setState((current) =>
          current.data
            ? { status: "error", data: current.data, error: message }
            : /NOT_FOUND|orphaned/u.test(message)
              ? { status: "empty", data: null, error: null }
              : { status: "error", data: null, error: message },
        );
      });
    return () => {
      active = false;
    };
  }, [attempt, projectId, rpc, stableKey, valid]);

  if (!valid) return { status: "invalid", data: null, error: null, retry };
  if (!projectId)
    return { status: "unconfigured", data: null, error: null, retry };
  return { ...state, retry } as FindingDetailState;
}
