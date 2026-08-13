import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";
import type Database from "better-sqlite3";
import type { PlatformClient, RemoteServices } from "../../lib/remote/types.js";
import type { JsonValue } from "../../shared/contract.js";
import { rpcContract } from "../../shared/contract.js";
import { applyHbomExtraction } from "./hbom/extract.js";
import {
  handleHbomCycloneDxExport,
  handleHbomXlsxExport,
} from "./hbom/export/http.js";
import {
  getHbomComponent,
  listHbomReview,
  resolveHbomReview,
} from "./hbom/review.js";
import { handleSbomExport } from "./sbom/export-http.js";
import { pullSbom } from "./sbom/pull.js";
import {
  queryComponentFindings,
  queryComponentLinks,
  querySbomForProject,
  type SbomSort,
  type SbomSortDirection,
  type SbomUiQuery,
} from "./sbom/query.js";
import type {
  SbomReachability,
  SbomSeverity,
  SbomPullInput,
  SbomPullResult,
} from "./sbom/types.js";

const bomRpcContract = {
  bomSoftwareList: rpcContract.bomSoftwareList,
  bomComponentGet: rpcContract.bomComponentGet,
  hbomReviewList: rpcContract.hbomReviewList,
  hbomReviewResolve: rpcContract.hbomReviewResolve,
  hbomExtractionApply: rpcContract.hbomExtractionApply,
} as const;

export interface BomCommandServices {
  pull(
    input: SbomPullInput & { worktreeRoot: string; signal?: AbortSignal },
  ): Promise<SbomPullResult>;
}

export function createBomCommandServices(
  bb: BbPluginApi,
  db: Database.Database,
  platform: () => Pick<PlatformClient, "listComponents">,
): BomCommandServices {
  return {
    pull({ worktreeRoot, signal, ...input }) {
      return pullSbom(
        {
          db,
          platform: platform(),
          worktreeRoot,
          ...(signal ? { signal } : {}),
          publishProgress(hint) {
            bb.realtime.publish("bom:progress", hint);
          },
          publishChanged(hint) {
            bb.realtime.publish("bom:changed", hint);
          },
          warn(message, details) {
            bb.log.warn(
              `${message}: ${details.count} for project version ${details.projectVersionId}`,
            );
          },
        },
        input,
      );
    },
  };
}

function optionalString(
  filters: Record<string, JsonValue>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = filters[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function optionalBoolean(
  filters: Record<string, JsonValue>,
  key: string,
): boolean | undefined {
  const value = filters[key];
  return typeof value === "boolean" ? value : undefined;
}

function isSeverity(value: string | undefined): value is SbomSeverity {
  return (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low"
  );
}

function isReachability(value: string | undefined): value is SbomReachability {
  return (
    value === "reachable" ||
    value === "unreachable" ||
    value === "mixed" ||
    value === "unknown"
  );
}

function isSort(value: string | undefined): value is SbomSort {
  return (
    value === "name" ||
    value === "severity" ||
    value === "kev" ||
    value === "license"
  );
}

function isSortDirection(
  value: string | undefined,
): value is SbomSortDirection {
  return value === "asc" || value === "desc";
}

const SOFTWARE_FILTERS = new Set([
  "architectureLinked",
  "componentKey",
  "component_key",
  "direction",
  "kev",
  "license",
  "linked",
  "localChange",
  "min_severity",
  "minimumSeverity",
  "name",
  "purl",
  "reachability",
  "search",
  "sort",
  "source",
]);

function softwareQuery(input: {
  projectVersionId: string | null;
  pageSize: number;
  continuation: string | null;
  filters?: Record<string, JsonValue>;
}): SbomUiQuery {
  if (input.projectVersionId === null) {
    throw new Error(
      "SBOM_PROJECT_VERSION_REQUIRED: software inventory is version-scoped",
    );
  }
  const filters = input.filters ?? {};
  const severity = optionalString(filters, "minimumSeverity", "min_severity");
  const reachability = optionalString(filters, "reachability");
  const sort = optionalString(filters, "sort");
  const direction = optionalString(filters, "direction");
  const unknown = Object.keys(filters).filter(
    (key) => !SOFTWARE_FILTERS.has(key),
  );
  if (unknown.length > 0) {
    throw new Error(
      `SBOM_FILTER_INVALID: unsupported filters: ${unknown.sort().join(", ")}`,
    );
  }
  if (severity && !isSeverity(severity)) {
    throw new Error("SBOM_FILTER_INVALID: minimum severity is invalid");
  }
  if (reachability && !isReachability(reachability)) {
    throw new Error("SBOM_FILTER_INVALID: reachability is invalid");
  }
  if (sort && !isSort(sort))
    throw new Error("SBOM_FILTER_INVALID: sort is invalid");
  if (direction && !isSortDirection(direction)) {
    throw new Error("SBOM_FILTER_INVALID: direction is invalid");
  }
  const linked =
    optionalBoolean(filters, "linked") ??
    optionalBoolean(filters, "architectureLinked");
  return {
    projectVersionId: input.projectVersionId,
    limit: input.pageSize,
    ...(input.continuation ? { cursor: input.continuation } : {}),
    ...(optionalString(filters, "search", "name")
      ? {
          search: optionalString(filters, "search", "name"),
        }
      : {}),
    ...(optionalString(filters, "purl")
      ? { purl: optionalString(filters, "purl") }
      : {}),
    ...(optionalString(filters, "license")
      ? { license: optionalString(filters, "license") }
      : {}),
    ...(isSeverity(severity) ? { minimumSeverity: severity } : {}),
    ...(optionalBoolean(filters, "kev") !== undefined
      ? { kev: optionalBoolean(filters, "kev") }
      : {}),
    ...(isReachability(reachability) ? { reachability } : {}),
    ...(optionalString(filters, "source")
      ? { source: optionalString(filters, "source") }
      : {}),
    ...(linked !== undefined ? { linked } : {}),
    ...(optionalBoolean(filters, "localChange") !== undefined
      ? { localChange: optionalBoolean(filters, "localChange") }
      : {}),
    ...(isSort(sort) ? { sort } : {}),
    ...(isSortDirection(direction) ? { direction } : {}),
    ...(optionalString(filters, "componentKey", "component_key")
      ? {
          componentKey: optionalString(
            filters,
            "componentKey",
            "component_key",
          ),
        }
      : {}),
  };
}

export function registerBom(bb: BbPluginApi, ctx: PluginContext): void {
  const db = ctx.db();
  ctx.service("bom.command-services", () =>
    createBomCommandServices(
      bb,
      db,
      () =>
        ctx.service<RemoteServices>("remote-services", () => {
          throw new Error("REMOTE_SERVICES_NOT_REGISTERED");
        }).platform,
    ),
  );
  bb.rpc.register(bomRpcContract, {
    bomSoftwareList(input) {
      const page = querySbomForProject(
        db,
        input.projectId,
        softwareQuery(input),
      );
      return {
        items: page.items.map((component) => ({
          projectId: input.projectId,
          projectVersionId: input.projectVersionId,
          kind: "sbomComponent",
          key: component.componentKey,
          label: component.name,
          fields: {
            purl: component.purl,
            cpe: component.cpe,
            group: component.group,
            version: component.version,
            license: component.license,
            supplier: component.supplier,
            source: component.source,
            upstreamStale: component.upstreamStale,
            files: component.files,
            fileCount: component.files.length,
            localChange: component.localChange,
            linked: component.linked,
            vuln: component.vuln,
            pulledAt: component.pulledAt,
          },
        })),
        total: page.total,
        next: page.cursor,
        cache: page.cache,
      };
    },
    bomComponentGet(input) {
      if (input.mode === "hardware") return getHbomComponent();
      if (input.projectVersionId === null) {
        throw new Error(
          "SBOM_PROJECT_VERSION_REQUIRED: software inventory is version-scoped",
        );
      }
      const page = querySbomForProject(db, input.projectId, {
        projectVersionId: input.projectVersionId,
        componentKey: input.componentId,
        limit: 1,
      });
      const component = page.items[0];
      if (!component) throw new Error("SBOM_COMPONENT_NOT_FOUND");
      const projectedLinks = queryComponentLinks(
        db,
        input.projectId,
        input.projectVersionId,
        component.purl,
      );
      const findings = queryComponentFindings(
        db,
        input.projectId,
        input.projectVersionId,
        component.componentKey,
      );
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        kind: "sbomComponent",
        key: component.componentKey,
        label: component.name,
        fields: {
          purl: component.purl,
          cpe: component.cpe,
          group: component.group,
          version: component.version,
          license: component.license,
          supplier: component.supplier,
          source: component.source,
          upstreamStale: component.upstreamStale,
          files: component.files,
          fileCount: component.files.length,
          findings,
          localChange: component.localChange,
          linked: component.linked,
          vuln: component.vuln,
          pulledAt: component.pulledAt,
        },
        links: projectedLinks.map((link) => ({
          projectId: input.projectId,
          projectVersionId: input.projectVersionId,
          kind: link.kind,
          key: link.key,
          label: link.label,
        })),
        cache: page.cache,
      };
    },
    hbomReviewList() {
      return listHbomReview();
    },
    hbomReviewResolve() {
      return resolveHbomReview();
    },
    hbomExtractionApply() {
      return applyHbomExtraction();
    },
  });

  bb.http.route("GET", "/sbom/export", handleSbomExport);
  bb.http.route("GET", "/hbom/export.xlsx", handleHbomXlsxExport);
  bb.http.route("GET", "/hbom/export.cdx.json", handleHbomCycloneDxExport);
}
