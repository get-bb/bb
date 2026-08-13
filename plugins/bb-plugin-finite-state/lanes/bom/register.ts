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
import { createSbomHttpHandler } from "./sbom/export-http.js";
import { pullSbom } from "./sbom/pull.js";
import { querySbomForProject } from "./sbom/query.js";
import type {
  SbomQuery,
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

function optionalString(filters: Record<string, JsonValue>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = filters[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function optionalBoolean(filters: Record<string, JsonValue>, key: string): boolean | undefined {
  const value = filters[key];
  return typeof value === "boolean" ? value : undefined;
}

function isSeverity(value: string | undefined): value is SbomSeverity {
  return value === "critical" || value === "high" || value === "medium" || value === "low";
}

function isReachability(value: string | undefined): value is SbomReachability {
  return value === "reachable" || value === "unreachable" || value === "mixed" || value === "unknown";
}

function softwareQuery(input: {
  projectVersionId: string | null;
  pageSize: number;
  continuation: string | null;
  filters?: Record<string, JsonValue>;
}): SbomQuery {
  if (input.projectVersionId === null) {
    throw new Error("SBOM_PROJECT_VERSION_REQUIRED: software inventory is version-scoped");
  }
  const filters = input.filters ?? {};
  const severity = optionalString(filters, "minimumSeverity", "min_severity");
  const reachability = optionalString(filters, "reachability");
  if (severity && !isSeverity(severity)) {
    throw new Error("SBOM_FILTER_INVALID: minimum severity is invalid");
  }
  if (reachability && !isReachability(reachability)) {
    throw new Error("SBOM_FILTER_INVALID: reachability is invalid");
  }
  return {
    projectVersionId: input.projectVersionId,
    limit: input.pageSize,
    ...(input.continuation ? { cursor: input.continuation } : {}),
    ...(optionalString(filters, "search", "name") ? {
      search: optionalString(filters, "search", "name"),
    } : {}),
    ...(optionalString(filters, "purl") ? { purl: optionalString(filters, "purl") } : {}),
    ...(optionalString(filters, "license") ? { license: optionalString(filters, "license") } : {}),
    ...(isSeverity(severity) ? { minimumSeverity: severity } : {}),
    ...(optionalBoolean(filters, "kev") !== undefined ? { kev: optionalBoolean(filters, "kev") } : {}),
    ...(isReachability(reachability) ? { reachability } : {}),
    ...(optionalString(filters, "componentKey", "component_key") ? {
      componentKey: optionalString(filters, "componentKey", "component_key"),
    } : {}),
  };
}

export function registerBom(bb: BbPluginApi, ctx: PluginContext): void {
  const db = ctx.db();
  ctx.service("bom.command-services", () => createBomCommandServices(
    bb,
    db,
    () => ctx.service<RemoteServices>("remote-services", () => {
      throw new Error("REMOTE_SERVICES_NOT_REGISTERED");
    }).platform,
  ));
  bb.rpc.register(bomRpcContract, {
    bomSoftwareList(input) {
      const page = querySbomForProject(db, input.projectId, softwareQuery(input));
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
            isStale: component.isStale,
            files: component.files,
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
        throw new Error("SBOM_PROJECT_VERSION_REQUIRED: software inventory is version-scoped");
      }
      const page = querySbomForProject(db, input.projectId, {
        projectVersionId: input.projectVersionId,
        componentKey: input.componentId,
        limit: 1,
      });
      const component = page.items[0];
      if (!component) throw new Error("SBOM_COMPONENT_NOT_FOUND");
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
          isStale: component.isStale,
          files: component.files,
          vuln: component.vuln,
          pulledAt: component.pulledAt,
        },
        links: [],
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

  bb.http.route("GET", "/sbom/export", createSbomHttpHandler({
    get platform() {
      return ctx.service<RemoteServices>("remote-services", () => {
        throw new Error("REMOTE_SERVICES_NOT_REGISTERED");
      }).platform;
    },
  }));
  bb.http.route("GET", "/hbom/export.xlsx", handleHbomXlsxExport);
  bb.http.route("GET", "/hbom/export.cdx.json", handleHbomCycloneDxExport);
}
