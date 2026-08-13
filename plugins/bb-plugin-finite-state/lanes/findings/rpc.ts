import type { BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import type { JsonValue } from "../../shared/contract.js";
import { rpcContract } from "../../shared/contract.js";
import { listFindingActivity } from "./cache/activity.js";
import {
  commentMutationAuthorizationUnavailable,
  listFindingComments,
} from "./cache/comments.js";
import { getCachedFinding, queryFindings } from "./cache/query.js";
import type { CachedFinding, FindingsFilter } from "./cache/types.js";

const findingsRpcContract = {
  findingsList: rpcContract.findingsList,
  findingsGet: rpcContract.findingsGet,
  findingsActivityList: rpcContract.findingsActivityList,
  findingsCommentsList: rpcContract.findingsCommentsList,
  findingsCommentsCreate: rpcContract.findingsCommentsCreate,
  findingsCommentsUpdate: rpcContract.findingsCommentsUpdate,
  findingsCommentsDelete: rpcContract.findingsCommentsDelete,
  findingsFacets: rpcContract.findingsFacets,
} as const;

function requireVersion(projectVersionId: string | null): string {
  if (projectVersionId === null) throw new Error("FINDINGS_PROJECT_VERSION_REQUIRED");
  return projectVersionId;
}

function stringArray(filters: Record<string, JsonValue>, key: string): string[] | undefined {
  const value = filters[key];
  if (!Array.isArray(value)) return undefined;
  const result = value.filter((item): item is string => typeof item === "string");
  return result.length > 0 ? result : undefined;
}

function stringValue(filters: Record<string, JsonValue>, key: string): string | undefined {
  const value = filters[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(filters: Record<string, JsonValue>, key: string): number | undefined {
  const value = filters[key];
  return typeof value === "number" ? value : undefined;
}

function booleanValue(filters: Record<string, JsonValue>, key: string): boolean | undefined {
  const value = filters[key];
  return typeof value === "boolean" ? value : undefined;
}

function findingFilter(input: {
  projectId: string;
  projectVersionId: string | null;
  pageSize: number;
  continuation: string | null;
  filters?: Record<string, JsonValue>;
}): FindingsFilter {
  const filters = input.filters ?? {};
  const reachability = stringValue(filters, "reachability");
  const kev = stringValue(filters, "kev");
  if (reachability && reachability !== "reachable" && reachability !== "unreachable" && reachability !== "unknown") {
    throw new Error("FINDINGS_FILTER_INVALID: reachability");
  }
  if (kev && kev !== "kev" && kev !== "vc-kev" && kev !== "none") {
    throw new Error("FINDINGS_FILTER_INVALID: kev");
  }
  const normalizedReachability = reachability as FindingsFilter["reachability"];
  const normalizedKev = kev as FindingsFilter["kev"];
  return {
    projectId: input.projectId,
    pvId: requireVersion(input.projectVersionId),
    limit: input.pageSize,
    ...(input.continuation ? { cursor: input.continuation } : {}),
    ...(stringArray(filters, "severity") ? { severity: stringArray(filters, "severity") } : {}),
    ...(normalizedReachability ? { reachability: normalizedReachability } : {}),
    ...(normalizedKev ? { kev: normalizedKev } : {}),
    ...(numberValue(filters, "epssGte") !== undefined ? { epssGte: numberValue(filters, "epssGte") } : {}),
    ...(stringValue(filters, "component") ? { component: stringValue(filters, "component") } : {}),
    ...(stringValue(filters, "cve") ? { cve: stringValue(filters, "cve") } : {}),
    ...(stringArray(filters, "triage") ? { triage: stringArray(filters, "triage") } : {}),
    ...(stringArray(filters, "findingType") ? { findingType: stringArray(filters, "findingType") } : {}),
    ...(booleanValue(filters, "hasLocalChange") !== undefined
      ? { hasLocalChange: booleanValue(filters, "hasLocalChange") }
      : {}),
  };
}

function fields(finding: CachedFinding): Record<string, JsonValue> {
  return {
    stableKey: finding.stableKey,
    findingType: finding.findingType,
    cve: finding.cve,
    title: finding.title,
    componentName: finding.componentName,
    componentGroup: finding.componentGroup,
    componentVersion: finding.componentVersion,
    componentPurl: finding.componentPurl,
    severity: finding.severity,
    riskScore: finding.riskScore,
    band: finding.band,
    cvssScore: finding.cvssScore,
    cvssVector: finding.cvssVector,
    epssScore: finding.epssScore,
    epssPercentile: finding.epssPercentile,
    inKev: finding.inKev,
    inVcKev: finding.inVcKev,
    hasExploit: finding.hasExploit,
    exploitMaturity: finding.exploitMaturity,
    reachabilityScore: finding.reachabilityScore,
    reachabilityVerdict: finding.reachabilityVerdict,
    reachabilityFactors: finding.reachabilityFactors,
    vulnInDataset: finding.vulnInDataset,
    cwes: finding.cwes,
    warningCount: finding.warningCount,
    violationCount: finding.violationCount,
    location: finding.location,
    vexStatus: finding.vexStatus,
    vexResponse: finding.vexResponse,
    vexJustification: finding.vexJustification,
    vexReason: finding.vexReason,
    commentCount: finding.comments.length,
    firstSeen: finding.firstSeen,
    softDeleted: finding.softDeleted,
    pulledAt: finding.pulledAt,
  };
}

function summary(finding: CachedFinding) {
  return {
    projectId: finding.projectId,
    projectVersionId: finding.projectVersionId,
    kind: "finding",
    key: finding.findingId,
    label: finding.title ?? finding.cve ?? finding.findingId,
    fields: fields(finding),
  };
}

export function registerFindingsRpc(bb: BbPluginApi, db: Database.Database): void {
  bb.rpc.register(findingsRpcContract, {
    findingsList(input) {
      const page = queryFindings(db, findingFilter(input));
      return {
        items: page.items.map(summary),
        total: page.total,
        next: page.nextCursor,
        cache: page.cache,
      };
    },
    findingsGet(input) {
      const pvId = requireVersion(input.projectVersionId);
      const cached = getCachedFinding(db, input.projectId, pvId, input.findingId);
      if (!cached.finding) throw new Error("FINDING_NOT_FOUND");
      return { ...summary(cached.finding), links: [], cache: cached.cache };
    },
    findingsActivityList(input) {
      // pagedScopedInput's frozen helper erases its extra-field type while its
      // runtime schema still validates and retains findingId.
      const findingId = (input as typeof input & { findingId: string }).findingId;
      const pvId = requireVersion(input.projectVersionId);
      const page = listFindingActivity(db, {
        projectId: input.projectId,
        projectVersionId: pvId,
        findingId,
        limit: input.pageSize,
        ...(input.continuation ? { cursor: input.continuation } : {}),
      });
      return {
        items: page.items.map(item => ({
          projectId: item.projectId,
          projectVersionId: item.projectVersionId,
          kind: "findingActivity",
          key: item.eventId,
          label: item.source ?? item.eventId,
          fields: {
            findingId: item.findingId,
            stableKey: item.stableKey,
            actor: item.actor,
            at: item.eventAt,
            source: item.source,
            old: item.oldTuple,
            new: item.newTuple,
            pulledAt: item.pulledAt,
          },
        })),
        total: page.total,
        next: page.next,
        cache: page.cache,
      };
    },
    findingsCommentsList(input) {
      // See the frozen pagedScopedInput type-erasure note above.
      const findingId = (input as typeof input & { findingId: string }).findingId;
      const pvId = requireVersion(input.projectVersionId);
      const page = listFindingComments(db, {
        projectId: input.projectId,
        projectVersionId: pvId,
        findingId,
        limit: input.pageSize,
        ...(input.continuation ? { cursor: input.continuation } : {}),
      });
      return {
        items: page.items.map(comment => ({
          projectId: input.projectId,
          projectVersionId: pvId,
          id: comment.id,
          findingId: comment.findingId,
          actorLabel: comment.actorLabel,
          text: comment.text,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          carriesAcrossVersions: false as const,
        })),
        total: page.total,
        next: page.next,
        cache: page.cache,
      };
    },
    findingsCommentsCreate() { return commentMutationAuthorizationUnavailable(); },
    findingsCommentsUpdate() { return commentMutationAuthorizationUnavailable(); },
    findingsCommentsDelete() { return commentMutationAuthorizationUnavailable(); },
    findingsFacets(input) {
      const pvId = requireVersion(input.projectVersionId);
      const page = queryFindings(db, { projectId: input.projectId, pvId, limit: 1 });
      return {
        projectId: input.projectId,
        projectVersionId: pvId,
        severity: page.facets.severity ?? {},
        triage: page.facets.triage ?? {},
        total: page.total,
        cache: page.cache,
      };
    },
  });
}
