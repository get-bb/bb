import { parseDocument } from "yaml";
import type {
  CrossSurfaceLink,
  CrossSurfaceLinkKind,
  FirmwareLinksDocument,
  LinkFamilyReadiness,
  ResolvedCrossSurfaceLinks,
  SbomLinksDocument,
} from "./schema.js";
import {
  firmwareLinksDocumentSchema,
  resolvedCrossSurfaceLinksSchema,
  sbomLinksDocumentSchema,
  stableSlugSchema,
} from "./schema.js";

const LINK_KINDS = [
  "sbom",
  "firmware",
  "requirement",
  "verification",
] as const satisfies readonly CrossSurfaceLinkKind[];

const DEFAULT_LABELS: Record<CrossSurfaceLinkKind, string> = {
  sbom: "SBOM entry",
  firmware: "Files in firmware",
  requirement: "Mitigating requirements",
  verification: "Verification runs",
};

export class LinkMappingValidationError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = "LinkMappingValidationError";
  }
}

export interface SurfaceTarget {
  target: string;
  label: string;
  provenance?: { source: string; at?: string };
}

export type SurfaceResolution =
  | {
      state: "ready";
      targets: readonly SurfaceTarget[];
      message?: string;
      provenance?: { source: string; at?: string };
    }
  | {
      state: "not_pulled" | "unavailable";
      targets?: readonly SurfaceTarget[];
      message?: string;
      provenance?: { source: string; at?: string };
    };

export interface LinkSurfaceResolver {
  resolve(input: {
    sourceSlug: string;
    mappedTargets: readonly SurfaceTarget[];
  }): Promise<SurfaceResolution>;
}

export interface MappingLoad<Document> {
  document: Document | null;
  error?: string;
}

export interface CrossSurfaceResolverInput {
  sourceSlug: string;
  sbom: MappingLoad<SbomLinksDocument>;
  firmware: MappingLoad<FirmwareLinksDocument>;
  surfaces: Partial<Record<CrossSurfaceLinkKind, LinkSurfaceResolver>>;
}

function yamlValue(text: string, file: string): unknown {
  if (Buffer.byteLength(text, "utf8") > 1_048_576) {
    throw new LinkMappingValidationError(file, "mapping exceeds the 1 MiB limit");
  }
  const parsed = parseDocument(text);
  const firstError = parsed.errors[0];
  if (firstError) {
    throw new LinkMappingValidationError(file, firstError.message);
  }
  try {
    return parsed.toJS({ maxAliasCount: 50 });
  } catch (error) {
    throw new LinkMappingValidationError(
      file,
      error instanceof Error ? error.message : "mapping could not be decoded",
    );
  }
}

export function parseSbomLinksYaml(
  text: string,
  file = ".fs/links/sbom.yaml",
): SbomLinksDocument {
  const parsed = sbomLinksDocumentSchema.safeParse(yamlValue(text, file));
  if (!parsed.success) {
    throw new LinkMappingValidationError(
      file,
      parsed.error.issues[0]?.message ?? "mapping does not match fs-sbom-links/v1",
    );
  }
  return parsed.data;
}

export function parseFirmwareLinksYaml(
  text: string,
  file = ".fs/links/firmware.yaml",
): FirmwareLinksDocument {
  const parsed = firmwareLinksDocumentSchema.safeParse(yamlValue(text, file));
  if (!parsed.success) {
    throw new LinkMappingValidationError(
      file,
      parsed.error.issues[0]?.message ??
        "mapping does not match fs-firmware-links/v1",
    );
  }
  return parsed.data;
}

function mappedSbomTargets(
  document: SbomLinksDocument | null,
  sourceSlug: string,
): SurfaceTarget[] {
  return (document?.links[sourceSlug] ?? []).map((entry) => ({
    target: entry.target,
    label: entry.label ?? entry.target,
    provenance: entry.provenance ?? { source: ".fs/links/sbom.yaml" },
  }));
}

function mappedFirmwareTargets(
  document: FirmwareLinksDocument | null,
  sourceSlug: string,
): SurfaceTarget[] {
  return (document?.links[sourceSlug] ?? []).map((entry) => ({
    target: entry.target,
    label: entry.label ?? entry.target,
    provenance: entry.provenance ?? { source: ".fs/links/firmware.yaml" },
  }));
}

function unreadyLink(
  kind: CrossSurfaceLinkKind,
  sourceSlug: string,
  reason: "not_pulled" | "not_mapped" | "unavailable",
  provenance?: { source: string; at?: string },
): CrossSurfaceLink {
  return {
    kind,
    sourceSlug,
    target: "",
    label: DEFAULT_LABELS[kind],
    ready: false,
    reason,
    ...(provenance ? { provenance } : {}),
  };
}

function readiness(
  kind: CrossSurfaceLinkKind,
  state: LinkFamilyReadiness["state"],
  message?: string,
  provenance?: { source: string; at?: string },
): LinkFamilyReadiness {
  return {
    kind,
    state,
    ...(message ? { message: message.slice(0, 500) } : {}),
    ...(provenance ? { provenance } : {}),
  };
}

function mappedTargetsFor(
  input: CrossSurfaceResolverInput,
  kind: CrossSurfaceLinkKind,
): readonly SurfaceTarget[] {
  if (kind === "sbom") {
    return mappedSbomTargets(input.sbom.document, input.sourceSlug);
  }
  if (kind === "firmware") {
    return mappedFirmwareTargets(input.firmware.document, input.sourceSlug);
  }
  return [];
}

function mappingErrorFor(
  input: CrossSurfaceResolverInput,
  kind: CrossSurfaceLinkKind,
): string | undefined {
  if (kind === "sbom") return input.sbom.error;
  if (kind === "firmware") return input.firmware.error;
  return undefined;
}

function mappingProvenance(
  kind: CrossSurfaceLinkKind,
): { source: string } | undefined {
  if (kind === "sbom") return { source: ".fs/links/sbom.yaml" };
  if (kind === "firmware") return { source: ".fs/links/firmware.yaml" };
  return undefined;
}

export async function resolveCrossSurfaceLinkFamily(
  input: CrossSurfaceResolverInput,
  kind: CrossSurfaceLinkKind,
): Promise<{ links: CrossSurfaceLink[]; readiness: LinkFamilyReadiness }> {
  const provenance = mappingProvenance(kind);
  const mappingError = mappingErrorFor(input, kind);
  if (mappingError) {
    return {
      links: [unreadyLink(kind, input.sourceSlug, "unavailable", provenance)],
      readiness: readiness(kind, "unavailable", mappingError, provenance),
    };
  }

  const mappedTargets = mappedTargetsFor(input, kind);
  if ((kind === "sbom" || kind === "firmware") && mappedTargets.length === 0) {
    return {
      links: [unreadyLink(kind, input.sourceSlug, "not_mapped", provenance)],
      readiness: readiness(
        kind,
        "not_mapped",
        `No ${kind} mapping exists for ${input.sourceSlug}.`,
        provenance,
      ),
    };
  }

  const surface = input.surfaces[kind];
  if (!surface) {
    return {
      links: [unreadyLink(kind, input.sourceSlug, "unavailable", provenance)],
      readiness: readiness(
        kind,
        "unavailable",
        `${DEFAULT_LABELS[kind]} is not implemented in this workspace.`,
        provenance,
      ),
    };
  }

  let result: SurfaceResolution;
  try {
    result = await surface.resolve({
      sourceSlug: input.sourceSlug,
      mappedTargets,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.length > 0
        ? error.message.slice(0, 500)
        : `${DEFAULT_LABELS[kind]} could not be resolved.`;
    return {
      links: [unreadyLink(kind, input.sourceSlug, "unavailable", provenance)],
      readiness: readiness(kind, "unavailable", message, provenance),
    };
  }

  if (result.state !== "ready") {
    return {
      links: [
        unreadyLink(
          kind,
          input.sourceSlug,
          result.state,
          result.provenance ?? provenance,
        ),
      ],
      readiness: readiness(
        kind,
        result.state,
        result.message,
        result.provenance ?? provenance,
      ),
    };
  }

  if (result.targets.length === 0) {
    return {
      links: [
        unreadyLink(
          kind,
          input.sourceSlug,
          "not_mapped",
          result.provenance ?? provenance,
        ),
      ],
      readiness: readiness(
        kind,
        "not_mapped",
        result.message ?? `No ${kind} links resolve for ${input.sourceSlug}.`,
        result.provenance ?? provenance,
      ),
    };
  }

  return {
    links: result.targets.map((target) => ({
      kind,
      sourceSlug: input.sourceSlug,
      target: target.target,
      label: target.label,
      ready: true,
      ...(target.provenance ?? result.provenance ?? provenance
        ? {
            provenance:
              target.provenance ?? result.provenance ?? provenance,
          }
        : {}),
    })),
    readiness: readiness(
      kind,
      "ready",
      result.message,
      result.provenance ?? provenance,
    ),
  };
}

export async function resolveCrossSurfaceLinks(
  input: CrossSurfaceResolverInput,
): Promise<ResolvedCrossSurfaceLinks> {
  const sourceSlug = stableSlugSchema.parse(input.sourceSlug);
  const families = await Promise.all(
    LINK_KINDS.map((kind) =>
      resolveCrossSurfaceLinkFamily({ ...input, sourceSlug }, kind),
    ),
  );
  return resolvedCrossSurfaceLinksSchema.parse({
    sourceSlug,
    links: families.flatMap((family) => family.links),
    readiness: families.map((family) => family.readiness),
  });
}
