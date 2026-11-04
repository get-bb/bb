import { getRelativeHostPath } from "@bb/domain";
import type { PathResolution } from "@bb/host-daemon-contract";
import { buildLocalFileAnchorHref } from "./markdown-local-file-link.js";
import {
  resolveMarkdownLocalFileTarget,
  type ResolvedMarkdownLocalFileTarget,
} from "./markdown-link-target.js";
import type { MarkdownRelativeLinkRoot } from "./markdown-link-routing.js";

export interface MarkdownRelativeLinkReference {
  fallback: ResolvedMarkdownLocalFileTarget;
  relativePath: string;
}

export type MarkdownRelativeLinkChoice =
  | { kind: "pending" }
  | { kind: "missing" }
  | { kind: "found"; href: string };

const TRUSTED_HOST_ABSOLUTE_LINKS = { kind: "trusted-host" } as const;

export function relativeLinkReference(
  href: string,
  roots: readonly MarkdownRelativeLinkRoot[],
): MarkdownRelativeLinkReference | null {
  const [root] = roots;
  if (root === undefined) return null;
  const target = resolveMarkdownLocalFileTarget(
    href,
    TRUSTED_HOST_ABSOLUTE_LINKS,
    { baseDir: root.rootPath, rootPath: root.rootPath },
  );
  if (target === null || target.sourceKind === "absolute") return null;
  const relativePath = getRelativeHostPath({
    candidatePath: target.link.path,
    rootPath: root.rootPath,
  });
  if (relativePath === null || relativePath === "") return null;
  return { fallback: target, relativePath };
}

function healedHref(
  reference: MarkdownRelativeLinkReference,
  path: string,
): string {
  return (
    buildLocalFileAnchorHref({ ...reference.fallback.link, path }, path) ?? path
  );
}

export function chooseRelativeLinkTarget(
  reference: MarkdownRelativeLinkReference,
  resolution: PathResolution | undefined,
): MarkdownRelativeLinkChoice {
  if (resolution === undefined) return { kind: "pending" };
  if (resolution.kind === "exact") {
    return { kind: "found", href: healedHref(reference, resolution.path) };
  }
  const [only, ...others] = resolution.paths;
  if (only === undefined || others.length > 0) return { kind: "missing" };
  return { kind: "found", href: healedHref(reference, only) };
}

export function mergeRootResolutions(
  resolutions: readonly PathResolution[],
): PathResolution {
  const exact = resolutions.find((resolution) => resolution.kind === "exact");
  if (exact !== undefined) return exact;
  return {
    kind: "matches",
    paths: resolutions.flatMap((resolution) =>
      resolution.kind === "matches" ? resolution.paths : [],
    ),
  };
}
