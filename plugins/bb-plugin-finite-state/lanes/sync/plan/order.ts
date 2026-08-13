import type { PlanItem, PlanOp } from "./index.js";

export type ReferenceGraph = ReadonlyMap<string, readonly string[]>;

const OPERATION_ORDER: Readonly<Record<PlanOp, number>> = {
  create: 0,
  update: 1,
  delete: 2,
  conflict: 3,
  orphan: 4,
  noop: 5,
};
const ORDERED_OPERATIONS = new Set<PlanOp>(["create", "update", "delete"]);

export function planItemId(item: Pick<PlanItem, "kind" | "key">): string {
  return `${item.kind}\0${item.key}`;
}

function compareItems(left: PlanItem, right: PlanItem): number {
  return OPERATION_ORDER[left.operation] - OPERATION_ORDER[right.operation]
    || left.kind.localeCompare(right.kind)
    || left.key.localeCompare(right.key);
}

function addEdge(
  outgoing: Map<string, Set<string>>,
  incoming: Map<string, number>,
  from: string,
  to: string,
): void {
  if (from === to) return;
  const targets = outgoing.get(from);
  if (targets === undefined || targets.has(to)) return;
  targets.add(to);
  incoming.set(to, (incoming.get(to) ?? 0) + 1);
}

function findCycle(
  ids: ReadonlySet<string>,
  outgoing: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    visited.add(id);
    active.add(id);
    stack.push(id);
    for (const next of outgoing.get(id) ?? []) {
      if (!ids.has(next)) continue;
      if (active.has(next)) {
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (!visited.has(next)) {
        const cycle = visit(next);
        if (cycle !== null) return cycle;
      }
    }
    stack.pop();
    active.delete(id);
    return null;
  };

  for (const id of [...ids].sort((left, right) => left.localeCompare(right))) {
    if (visited.has(id)) continue;
    const cycle = visit(id);
    if (cycle !== null) return cycle;
  }
  return [];
}

/**
 * Orders write items topologically. Creates/updates follow dependency edges;
 * deletes invert those edges so referrers are removed before their targets.
 */
export function orderPlanItems(
  items: readonly PlanItem[],
  references: ReferenceGraph,
): PlanItem[] {
  const byId = new Map(items.map((item) => [planItemId(item), item]));
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, number>();
  for (const id of byId.keys()) {
    outgoing.set(id, new Set());
    incoming.set(id, 0);
  }

  for (const item of items) {
    if (!ORDERED_OPERATIONS.has(item.operation)) continue;
    const itemId = planItemId(item);
    for (const dependencyId of references.get(itemId) ?? []) {
      const dependency = byId.get(dependencyId);
      if (dependency === undefined || !ORDERED_OPERATIONS.has(dependency.operation)) continue;
      if (item.operation === "delete" && dependency.operation === "delete") {
        addEdge(outgoing, incoming, itemId, dependencyId);
      } else if (item.operation !== "delete" && dependency.operation !== "delete") {
        addEdge(outgoing, incoming, dependencyId, itemId);
      }
    }
  }

  const ready = items.filter((item) => incoming.get(planItemId(item)) === 0).sort(compareItems);
  const ordered: PlanItem[] = [];
  while (ready.length > 0) {
    const item = ready.shift();
    if (item === undefined) break;
    ordered.push(item);
    for (const dependentId of outgoing.get(planItemId(item)) ?? []) {
      const remaining = (incoming.get(dependentId) ?? 0) - 1;
      incoming.set(dependentId, remaining);
      if (remaining === 0) {
        const dependent = byId.get(dependentId);
        if (dependent !== undefined) {
          ready.push(dependent);
          ready.sort(compareItems);
        }
      }
    }
  }

  if (ordered.length === items.length) return ordered;

  const remainingIds = new Set(
    [...byId.keys()].filter((id) => !ordered.some((item) => planItemId(item) === id)),
  );
  const cycle = findCycle(remainingIds, outgoing);
  const cycleIds = new Set(cycle);
  const cycleLabels = cycle.map((id) => byId.get(id)?.label ?? id);
  const message = `Reference cycle: ${cycleLabels.join(" -> ")}`;
  const remaining = [...remainingIds]
    .map((id) => byId.get(id))
    .filter((item): item is PlanItem => item !== undefined)
    .sort(compareItems)
    .map((item) => cycleIds.has(planItemId(item)) && item.error === null
      ? {
        ...item,
        error: {
          code: "REFERENCE_CYCLE",
          message,
          artifactId: null,
          line: null,
        },
      }
      : item);
  return [...ordered, ...remaining];
}
