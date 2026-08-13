import { join } from "node:path";
import type { BbPluginApi } from "@bb/plugin-sdk";
import type { z } from "zod";
import type { PluginContext } from "../../../../lib/context.js";
import {
  jsonValueSchema,
  rpcContract,
  type JsonValue,
} from "../../../../shared/contract.js";
import {
  CANVAS_LAYOUT_FILE,
  canvasLayoutsEqual,
  mergeDiscoveredNodes,
  normalizeCanvasLayout,
  serializeCanvasLayout,
} from "./layout-store.js";
import {
  parseFirmwareLinksYaml,
  parseSbomLinksYaml,
  resolveCrossSurfaceLinkFamily,
  type CrossSurfaceResolverInput,
  type LinkSurfaceResolver,
  type MappingLoad,
  type SurfaceTarget,
} from "./resolver.js";
import {
  canvasLayoutV1Schema,
  canvasLinksRpcContract,
  type CanvasLayoutV1,
  type FirmwareLinksDocument,
  type SbomLinksDocument,
} from "./schema.js";

const SBOM_LINKS_FILE = ".fs/links/sbom.yaml";
const FIRMWARE_LINKS_FILE = ".fs/links/firmware.yaml";

interface ProjectSource {
  hostId: string;
  path: string;
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 500)
    : fallback;
}

function isMissingFile(error: unknown): boolean {
  return /\bENOENT\b|not found|does not exist/iu.test(
    error instanceof Error ? error.message : String(error),
  );
}

function decodeText(
  content: string,
  contentEncoding: "utf8" | "base64",
): string {
  return contentEncoding === "utf8"
    ? content
    : Buffer.from(content, "base64").toString("utf8");
}

async function projectSource(
  bb: BbPluginApi,
  projectId: string,
): Promise<ProjectSource> {
  const project = await bb.sdk.projects.get({ projectId });
  const source =
    project.sources.find((candidate) => candidate.isDefault) ??
    project.sources[0];
  if (!source) throw new Error("The project has no local workspace source.");
  return { hostId: source.hostId, path: source.path };
}

async function readOptionalText(
  bb: BbPluginApi,
  source: ProjectSource,
  relativePath: string,
): Promise<{ content: string; sha256: string } | null> {
  try {
    const file = await bb.sdk.files.read({
      hostId: source.hostId,
      path: join(source.path, relativePath),
      rootPath: source.path,
    });
    return {
      content: decodeText(file.content, file.contentEncoding),
      sha256: file.sha256,
    };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function readMapping<Document>(
  bb: BbPluginApi,
  source: ProjectSource,
  file: string,
  parse: (text: string, file: string) => Document,
): Promise<MappingLoad<Document>> {
  try {
    const read = await readOptionalText(bb, source, file);
    return { document: read ? parse(read.content, file) : null };
  } catch (error) {
    return {
      document: null,
      error: safeMessage(error, `${file} could not be read.`),
    };
  }
}

async function callOwnRpc<Schema extends z.ZodType>(
  bb: BbPluginApi,
  method: string,
  input: JsonValue,
  outputSchema: Schema,
): Promise<z.output<Schema>> {
  const result = await bb.sdk.plugins.callRpc({
    pluginId: bb.pluginId,
    method,
    input: jsonValueSchema.parse(input),
    outputSchema,
  });
  return outputSchema.parse(result);
}

function sbomSurface(
  bb: BbPluginApi,
  scope: { projectId: string; projectVersionId: string | null },
): LinkSurfaceResolver {
  return {
    async resolve({ mappedTargets }) {
      const pages = await Promise.all(
        mappedTargets.map(async (mapping) => ({
          mapping,
          page: await callOwnRpc(
            bb,
            "bomSoftwareList",
            {
              ...scope,
              pageSize: 2,
              continuation: null,
              filters: { purl: mapping.target },
            },
            rpcContract.bomSoftwareList.output,
          ),
        })),
      );
      if (pages.some(({ page }) => page.cache.state === "empty")) {
        return {
          state: "not_pulled",
          message: "Pull the SBOM before opening mapped packages.",
          provenance: { source: SBOM_LINKS_FILE },
        };
      }
      const targets: SurfaceTarget[] = [];
      for (const { mapping, page } of pages) {
        const exact = page.items.find(
          (item) => item.fields["purl"] === mapping.target,
        );
        if (!exact) continue;
        targets.push({
          target: exact.key,
          label: exact.label,
          provenance: mapping.provenance,
        });
      }
      return {
        state: "ready",
        targets,
        ...(targets.length < mappedTargets.length
          ? {
              message: `${mappedTargets.length - targets.length} mapped SBOM target(s) are absent from the accepted cache.`,
            }
          : {}),
        provenance: { source: SBOM_LINKS_FILE },
      };
    },
  };
}

function firmwareSurface(
  bb: BbPluginApi,
  scope: { projectId: string; projectVersionId: string | null },
): LinkSurfaceResolver {
  return {
    async resolve({ mappedTargets }) {
      const mount = await callOwnRpc(
        bb,
        "firmwareMountGet",
        scope,
        rpcContract.firmwareMountGet.output,
      );
      if (mount.cache.state === "empty") {
        return {
          state: "not_pulled",
          message: "Materialize firmware before opening mapped paths.",
          provenance: { source: FIRMWARE_LINKS_FILE },
        };
      }
      const settled = await Promise.allSettled(
        mappedTargets.map(async (mapping) => {
          await callOwnRpc(
            bb,
            "firmwareFileGet",
            {
              ...scope,
              firmwarePath: mapping.target,
              includePreview: false,
            },
            rpcContract.firmwareFileGet.output,
          );
          return mapping;
        }),
      );
      const targets = settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failures = settled.length - targets.length;
      return {
        state: "ready",
        targets,
        ...(failures > 0
          ? {
              message: `${failures} mapped firmware path(s) are unavailable; other paths remain interactive.`,
            }
          : {}),
        provenance: { source: FIRMWARE_LINKS_FILE },
      };
    },
  };
}

function verificationSurface(
  bb: BbPluginApi,
  scope: { projectId: string; projectVersionId: string | null },
): LinkSurfaceResolver {
  return {
    async resolve({ sourceSlug }) {
      const page = await callOwnRpc(
        bb,
        "verificationsMatrix",
        {
          ...scope,
          pageSize: 200,
          continuation: null,
          filters: { component: sourceSlug },
        },
        rpcContract.verificationsMatrix.output,
      );
      if (page.cache.state === "empty") {
        return {
          state: "not_pulled",
          message: "Pull verification evidence before opening runs.",
        };
      }
      const unresolved = page.items.filter(
        (item) =>
          typeof item.fields["requirementId"] !== "string" ||
          typeof item.fields["tier"] !== "string",
      ).length;
      return {
        state: "ready",
        targets: page.items.flatMap((item) => {
          const requirementId = item.fields["requirementId"];
          const tier = item.fields["tier"];
          return typeof requirementId === "string" && typeof tier === "string"
            ? [
                {
                  target: `${requirementId}/${tier}`,
                  label: item.label,
                  provenance: page.cache.asOf
                    ? { source: "verification cache", at: page.cache.asOf }
                    : { source: "verification cache" },
                },
              ]
            : [];
        }),
        ...(unresolved > 0
          ? {
              message: `${unresolved} verification row(s) lack canonical requirement/tier route coordinates.`,
            }
          : {}),
        provenance: page.cache.asOf
          ? { source: "verification cache", at: page.cache.asOf }
          : { source: "verification cache" },
      };
    },
  };
}

function requirementSurface(
  bb: BbPluginApi,
  scope: { projectId: string; projectVersionId: string | null },
): LinkSurfaceResolver {
  return {
    async resolve({ sourceSlug }) {
      const page = await callOwnRpc(
        bb,
        "requirementsList",
        {
          ...scope,
          pageSize: 200,
          continuation: null,
          filters: { component: sourceSlug },
        },
        rpcContract.requirementsList.output,
      );
      if (page.cache.state === "empty") {
        return {
          state: "not_pulled",
          message: "Pull requirements before opening mitigations.",
        };
      }
      return {
        state: "ready",
        targets: page.items.map((item) => ({
          target: item.key,
          label: item.label,
          provenance: page.cache.asOf
            ? { source: "requirements cache", at: page.cache.asOf }
            : { source: "requirements cache" },
        })),
        provenance: page.cache.asOf
          ? { source: "requirements cache", at: page.cache.asOf }
          : { source: "requirements cache" },
      };
    },
  };
}

function emptyResolverInput(
  sourceSlug: string,
  surfaces: CrossSurfaceResolverInput["surfaces"],
): CrossSurfaceResolverInput {
  return {
    sourceSlug,
    sbom: { document: null },
    firmware: { document: null },
    surfaces,
  };
}

function familyResult(
  sourceSlug: string,
  family: Awaited<ReturnType<typeof resolveCrossSurfaceLinkFamily>>,
) {
  return { sourceSlug, links: family.links, readiness: family.readiness };
}

async function loadLayoutDocument(
  bb: BbPluginApi,
  source: ProjectSource,
): Promise<{ layout: CanvasLayoutV1 | null; sha256: string | null }> {
  const read = await readOptionalText(bb, source, CANVAS_LAYOUT_FILE);
  if (!read) return { layout: null, sha256: null };
  let decoded: unknown;
  try {
    decoded = JSON.parse(read.content);
  } catch {
    throw new Error(`${CANVAS_LAYOUT_FILE} is not valid JSON.`);
  }
  return {
    layout: canvasLayoutV1Schema.parse(decoded),
    sha256: read.sha256,
  };
}

export function registerCanvasLinksBackend(
  bb: BbPluginApi,
  _ctx: PluginContext,
): void {
  bb.rpc.register(canvasLinksRpcContract, {
    async canvasSbomLinks(input) {
      const source = await projectSource(bb, input.projectId);
      const mapping: MappingLoad<SbomLinksDocument> = await readMapping(
        bb,
        source,
        SBOM_LINKS_FILE,
        parseSbomLinksYaml,
      );
      const family = await resolveCrossSurfaceLinkFamily(
        {
          ...emptyResolverInput(input.sourceSlug, {
            sbom: sbomSurface(bb, input),
          }),
          sbom: mapping,
        },
        "sbom",
      );
      return familyResult(input.sourceSlug, family);
    },
    async canvasFirmwareLinks(input) {
      const source = await projectSource(bb, input.projectId);
      const mapping: MappingLoad<FirmwareLinksDocument> = await readMapping(
        bb,
        source,
        FIRMWARE_LINKS_FILE,
        parseFirmwareLinksYaml,
      );
      const family = await resolveCrossSurfaceLinkFamily(
        {
          ...emptyResolverInput(input.sourceSlug, {
            firmware: firmwareSurface(bb, input),
          }),
          firmware: mapping,
        },
        "firmware",
      );
      return familyResult(input.sourceSlug, family);
    },
    async canvasRequirementLinks(input) {
      const family = await resolveCrossSurfaceLinkFamily(
        emptyResolverInput(input.sourceSlug, {
          requirement: requirementSurface(bb, input),
        }),
        "requirement",
      );
      return familyResult(input.sourceSlug, family);
    },
    async canvasVerificationLinks(input) {
      const family = await resolveCrossSurfaceLinkFamily(
        emptyResolverInput(input.sourceSlug, {
          verification: verificationSurface(bb, input),
        }),
        "verification",
      );
      return familyResult(input.sourceSlug, family);
    },
    async canvasLayoutLoad(input) {
      const source = await projectSource(bb, input.projectId);
      const stored = await loadLayoutDocument(bb, source);
      const merged = await mergeDiscoveredNodes(
        input.projectId,
        stored.layout,
        input.nodes,
        input.edges,
      );
      return {
        layout: merged.layout,
        file: CANVAS_LAYOUT_FILE,
        sha256: stored.sha256,
        needsSave:
          stored.layout === null ||
          !canvasLayoutsEqual(stored.layout, merged.layout),
        orphanSlugs: merged.orphanSlugs,
      };
    },
    async canvasLayoutSave(input) {
      const source = await projectSource(bb, input.projectId);
      const next = normalizeCanvasLayout(input.layout);
      if (next.project !== input.projectId) {
        throw new Error("Canvas layout project does not match the RPC scope.");
      }
      const current = await loadLayoutDocument(bb, source);
      if (current.sha256 !== input.expectedSha256) {
        return {
          outcome: "conflict" as const,
          file: CANVAS_LAYOUT_FILE,
          currentSha256: current.sha256,
        };
      }
      if (
        current.layout &&
        current.sha256 &&
        canvasLayoutsEqual(current.layout, next)
      ) {
        return {
          outcome: "saved" as const,
          file: CANVAS_LAYOUT_FILE,
          sha256: current.sha256,
          changed: false,
        };
      }
      const result = await bb.sdk.files.write({
        hostId: source.hostId,
        path: join(source.path, CANVAS_LAYOUT_FILE),
        rootPath: source.path,
        content: serializeCanvasLayout(next),
        contentEncoding: "utf8",
        createParents: true,
        expectedSha256: input.expectedSha256,
      });
      if (result.outcome === "conflict") {
        return {
          outcome: "conflict" as const,
          file: CANVAS_LAYOUT_FILE,
          currentSha256: result.currentSha256,
        };
      }
      bb.realtime.publish("canvas:layout-changed", {
        projectId: input.projectId,
        file: CANVAS_LAYOUT_FILE,
      });
      return {
        outcome: "saved" as const,
        file: CANVAS_LAYOUT_FILE,
        sha256: result.sha256,
        changed: true,
      };
    },
  });
}
