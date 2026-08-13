import type { JsonValue } from "../../../../shared/contract.js";

export interface AttackPathView {
  routeSignature: string;
  threatSlug: string | null;
  steps: {
    order: number;
    nodeSlug?: string;
    edgeSlug?: string;
    label: string;
    resolved: boolean;
  }[];
  exploitability: unknown;
  viability: "viable" | "not_viable" | "unknown";
}

export interface CachedAttackPathStep {
  order: number;
  label: string;
  nodeSlug: string | null;
  edgeSlug: string | null;
  sourceSlug: string | null;
  targetSlug: string | null;
}

export interface ArchitecturePathEdge {
  slug: string;
  sourceSlug: string;
  targetSlug: string;
}

export type ResolvedAttackPathStep = AttackPathView["steps"][number] & {
  candidateEdgeSlugs: string[];
  ambiguous: boolean;
};

export interface ResolvedAttackPath {
  view: AttackPathView;
  steps: ResolvedAttackPathStep[];
  highlightedSlugs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  value: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

export function parseAttackPathSteps(
  encoded: string,
): { steps: CachedAttackPathStep[]; error: string | null } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded);
  } catch {
    return {
      steps: [],
      error: "Cached attack-path steps are malformed JSON.",
    };
  }
  if (!Array.isArray(decoded)) {
    return {
      steps: [],
      error: "Cached attack-path steps must be an ordered list.",
    };
  }
  const steps: CachedAttackPathStep[] = [];
  for (let index = 0; index < decoded.length; index += 1) {
    const candidate = decoded[index];
    if (!isRecord(candidate)) {
      return {
        steps: [],
        error: `Cached attack-path step ${index + 1} is not an object.`,
      };
    }
    const orderValue = candidate.order ?? candidate.step ?? index + 1;
    if (
      typeof orderValue !== "number" ||
      !Number.isInteger(orderValue) ||
      orderValue < 0
    ) {
      return {
        steps: [],
        error: `Cached attack-path step ${index + 1} has an invalid order.`,
      };
    }
    const nodeSlug = optionalString(
      candidate,
      "nodeSlug",
      "node_slug",
      "componentSlug",
      "component_slug",
      "node",
    );
    const edgeSlug = optionalString(
      candidate,
      "edgeSlug",
      "edge_slug",
      "dataflowSlug",
      "dataflow_slug",
      "edge",
    );
    const sourceSlug = optionalString(
      candidate,
      "sourceSlug",
      "source_slug",
      "source",
      "from",
    );
    const targetSlug = optionalString(
      candidate,
      "targetSlug",
      "target_slug",
      "target",
      "to",
    );
    const label =
      optionalString(candidate, "label", "name", "description") ??
      edgeSlug ??
      nodeSlug ??
      `Step ${orderValue}`;
    steps.push({
      order: orderValue,
      label,
      nodeSlug,
      edgeSlug,
      sourceSlug,
      targetSlug,
    });
  }
  steps.sort((left, right) => left.order - right.order);
  return { steps, error: null };
}

export function parseExploitability(encoded: string | null): JsonValue {
  if (!encoded) return null;
  try {
    const value: unknown = JSON.parse(encoded);
    if (isJsonValue(value)) return value;
  } catch {
    return encoded;
  }
  return encoded;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

export function resolveAttackPath(
  routeSignature: string,
  threatSlug: string | null,
  cachedSteps: readonly CachedAttackPathStep[],
  exploitability: unknown,
  viability: AttackPathView["viability"],
  nodeSlugs: ReadonlySet<string>,
  edges: readonly ArchitecturePathEdge[],
): ResolvedAttackPath {
  const edgesBySlug = new Map(edges.map((edge) => [edge.slug, edge]));
  const steps = cachedSteps.map((step): ResolvedAttackPathStep => {
    let candidateEdgeSlugs: string[] = [];
    if (step.edgeSlug && edgesBySlug.has(step.edgeSlug)) {
      candidateEdgeSlugs = [step.edgeSlug];
    } else if (step.sourceSlug && step.targetSlug) {
      candidateEdgeSlugs = edges
        .filter(
          (edge) =>
            edge.sourceSlug === step.sourceSlug &&
            edge.targetSlug === step.targetSlug,
        )
        .map((edge) => edge.slug);
    }
    const nodeResolved = Boolean(
      step.nodeSlug && nodeSlugs.has(step.nodeSlug),
    );
    const resolved = nodeResolved || candidateEdgeSlugs.length > 0;
    return {
      order: step.order,
      label: step.label,
      ...(step.nodeSlug ? { nodeSlug: step.nodeSlug } : {}),
      ...(candidateEdgeSlugs.length === 1
        ? { edgeSlug: candidateEdgeSlugs[0] }
        : step.edgeSlug
          ? { edgeSlug: step.edgeSlug }
          : {}),
      resolved,
      candidateEdgeSlugs,
      ambiguous: candidateEdgeSlugs.length > 1,
    };
  });
  const highlightedSlugs = [
    ...steps.flatMap((step) => (step.nodeSlug && step.resolved ? [step.nodeSlug] : [])),
    ...steps.flatMap((step) => step.candidateEdgeSlugs),
  ];
  return {
    view: {
      routeSignature,
      threatSlug,
      steps: steps.map(
        ({ candidateEdgeSlugs: _candidates, ambiguous: _ambiguous, ...step }) =>
          step,
      ),
      exploitability,
      viability,
    },
    steps,
    highlightedSlugs: [...new Set(highlightedSlugs)],
  };
}
