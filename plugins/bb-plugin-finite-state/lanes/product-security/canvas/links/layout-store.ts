import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { LayoutResult } from "../foundation/types.js";
import { runElkLayout } from "../foundation/elk-worker.js";
import type { CanvasLayoutV1 } from "./schema.js";
import {
  canvasLayoutCandidateSchema,
  canvasLayoutV1Schema,
  stableSlugSchema,
} from "./schema.js";

export const CANVAS_LAYOUT_FILE = "product-security/layout/canvas.json" as const;

export class CanvasLayoutConflictError extends Error {
  constructor(
    readonly file: string,
    readonly expectedSha256: string | undefined,
    readonly currentSha256: string | undefined,
  ) {
    super(
      "Canvas layout changed outside this session. Reload and compare before saving again.",
    );
    this.name = "CanvasLayoutConflictError";
  }
}

export interface LoadedCanvasLayout {
  file: string;
  layout: CanvasLayoutV1 | null;
  sha256: string | undefined;
}

export interface DiscoveredLayoutNode {
  slug: string;
  width: number;
  height: number;
  collapsed?: boolean;
}

export interface DiscoveredLayoutEdge {
  source: string;
  target: string;
}

export interface LayoutMergeResult {
  layout: CanvasLayoutV1;
  orphanSlugs: string[];
  discoveredSlugs: string[];
}

export type LayoutArranger = (input: {
  nodes: readonly DiscoveredLayoutNode[];
  edges: readonly DiscoveredLayoutEdge[];
}) => Promise<Record<string, { x: number; y: number }>>;

function hash(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function canonicalRoot(root: string): Promise<string> {
  if (!isAbsolute(root)) {
    throw new Error("Canvas layout persistence requires an absolute project root.");
  }
  return realpath(root);
}

function confinedFile(root: string): string {
  const file = resolve(root, CANVAS_LAYOUT_FILE);
  const fromRoot = relative(root, file);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("Canvas layout path escaped the project root.");
  }
  return file;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function normalizedNode(
  node: CanvasLayoutV1["nodes"][string],
): CanvasLayoutV1["nodes"][string] {
  return {
    x: Math.round(node.x),
    y: Math.round(node.y),
    ...(node.collapsed === true ? { collapsed: true } : {}),
  };
}

export function normalizeCanvasLayout(layout: CanvasLayoutV1): CanvasLayoutV1 {
  const parsed = canvasLayoutCandidateSchema.parse(layout);
  const nodes: CanvasLayoutV1["nodes"] = {};
  for (const slug of Object.keys(parsed.nodes).sort()) {
    const node = parsed.nodes[slug];
    if (node) nodes[slug] = normalizedNode(node);
  }
  return {
    schema: "fs-canvas-layout/v1",
    project: parsed.project,
    nodes,
  };
}

export function serializeCanvasLayout(layout: CanvasLayoutV1): string {
  return `${JSON.stringify(normalizeCanvasLayout(layout), null, 2)}\n`;
}

export function canvasLayoutsEqual(
  left: CanvasLayoutV1,
  right: CanvasLayoutV1,
): boolean {
  return serializeCanvasLayout(left) === serializeCanvasLayout(right);
}

async function readCurrent(file: string): Promise<{
  content: string;
  layout: CanvasLayoutV1;
  sha256: string;
} | null> {
  try {
    const content = await readFile(file, "utf8");
    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
    } catch {
      throw new Error(`${CANVAS_LAYOUT_FILE} is not valid JSON.`);
    }
    const layout = canvasLayoutV1Schema.parse(decoded);
    return { content, layout, sha256: hash(content) };
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

export async function loadLayout(root: string): Promise<LoadedCanvasLayout> {
  const projectRoot = await canonicalRoot(root);
  const file = confinedFile(projectRoot);
  const current = await readCurrent(file);
  return {
    file,
    layout: current?.layout ?? null,
    sha256: current?.sha256,
  };
}

export async function saveLayout(
  root: string,
  next: CanvasLayoutV1,
  expectedSha256?: string,
): Promise<{ file: string; sha256: string; changed: boolean }> {
  const projectRoot = await canonicalRoot(root);
  const file = confinedFile(projectRoot);
  const normalized = normalizeCanvasLayout(next);
  const serialized = serializeCanvasLayout(normalized);
  const observed = await readCurrent(file);

  if (expectedSha256 !== undefined && observed?.sha256 !== expectedSha256) {
    throw new CanvasLayoutConflictError(
      file,
      expectedSha256,
      observed?.sha256,
    );
  }
  if (observed && canvasLayoutsEqual(observed.layout, normalized)) {
    return { file, sha256: observed.sha256, changed: false };
  }

  await mkdir(dirname(file), { recursive: true });
  const temporary = join(
    dirname(file),
    `.${CANVAS_LAYOUT_FILE.split("/").at(-1)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o644 });
    const immediatelyBeforeCommit = await readCurrent(file);
    if (immediatelyBeforeCommit?.sha256 !== observed?.sha256) {
      throw new CanvasLayoutConflictError(
        file,
        observed?.sha256,
        immediatelyBeforeCommit?.sha256,
      );
    }
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return { file, sha256: hash(serialized), changed: true };
}

async function arrangeWithElk(input: {
  nodes: readonly DiscoveredLayoutNode[];
  edges: readonly DiscoveredLayoutEdge[];
}): Promise<Record<string, { x: number; y: number }>> {
  const result: LayoutResult = await runElkLayout({
    nodes: input.nodes.map((node) => ({
      id: node.slug,
      width: node.width,
      height: node.height,
    })),
    edges: input.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
    })),
    direction: "RIGHT",
  });
  return result.positions;
}

function discoveredBySlug(
  nodes: readonly DiscoveredLayoutNode[],
): Map<string, DiscoveredLayoutNode> {
  const result = new Map<string, DiscoveredLayoutNode>();
  for (const node of nodes) {
    const slug = stableSlugSchema.parse(node.slug);
    if (result.has(slug)) {
      throw new Error(`Canvas contains duplicate stable slug ${slug}.`);
    }
    if (
      !Number.isFinite(node.width) ||
      node.width <= 0 ||
      !Number.isFinite(node.height) ||
      node.height <= 0
    ) {
      throw new Error(`Canvas node ${slug} has invalid dimensions.`);
    }
    result.set(slug, { ...node, slug });
  }
  return result;
}

export async function mergeDiscoveredNodes(
  project: string,
  stored: CanvasLayoutV1 | null,
  nodes: readonly DiscoveredLayoutNode[],
  edges: readonly DiscoveredLayoutEdge[],
  arrange: LayoutArranger = arrangeWithElk,
): Promise<LayoutMergeResult> {
  const bySlug = discoveredBySlug(nodes);
  const current = stored
    ? normalizeCanvasLayout(stored)
    : ({
        schema: "fs-canvas-layout/v1",
        project,
        nodes: {},
      } satisfies CanvasLayoutV1);
  if (current.project !== project) {
    throw new Error(
      `Canvas layout belongs to project ${current.project}, not ${project}.`,
    );
  }

  const discoveredSlugs = [...bySlug.keys()].sort();
  const discoveredSet = new Set(discoveredSlugs);
  const orphanSlugs = Object.keys(current.nodes)
    .filter((slug) => !discoveredSet.has(slug))
    .sort();
  const newNodes = discoveredSlugs.flatMap((slug) => {
    const node = bySlug.get(slug);
    return node && !current.nodes[slug] ? [node] : [];
  });
  if (newNodes.length === 0) {
    return { layout: current, orphanSlugs, discoveredSlugs };
  }

  const newSlugs = new Set(newNodes.map((node) => node.slug));
  const newEdges = edges.filter(
    (edge) => newSlugs.has(edge.source) && newSlugs.has(edge.target),
  );
  const arranged = await arrange({ nodes: newNodes, edges: newEdges });
  const knownPositions = discoveredSlugs.flatMap((slug) => {
    const position = current.nodes[slug];
    return position ? [position] : [];
  });
  const offsetX =
    knownPositions.length === 0
      ? 0
      : Math.max(...knownPositions.map((position) => position.x)) + 320;
  const nextNodes: CanvasLayoutV1["nodes"] = { ...current.nodes };
  newNodes.forEach((node, index) => {
    const position = arranged[node.slug] ?? {
      x: (index % 4) * 288,
      y: Math.floor(index / 4) * 176,
    };
    nextNodes[node.slug] = normalizedNode({
      x: position.x + offsetX,
      y: position.y,
      ...(node.collapsed === true ? { collapsed: true } : {}),
    });
  });
  return {
    layout: normalizeCanvasLayout({ ...current, nodes: nextNodes }),
    orphanSlugs,
    discoveredSlugs,
  };
}

export function pruneLayoutOrphans(
  layout: CanvasLayoutV1,
  orphanSlugs: readonly string[],
): { layout: CanvasLayoutV1; pruned: string[] } {
  const normalized = normalizeCanvasLayout(layout);
  const requested = [...new Set(orphanSlugs.map((slug) => stableSlugSchema.parse(slug)))];
  const nodes = { ...normalized.nodes };
  const pruned: string[] = [];
  for (const slug of requested.sort()) {
    if (!Object.hasOwn(nodes, slug)) continue;
    delete nodes[slug];
    pruned.push(slug);
  }
  return {
    layout: normalizeCanvasLayout({ ...normalized, nodes }),
    pruned,
  };
}
