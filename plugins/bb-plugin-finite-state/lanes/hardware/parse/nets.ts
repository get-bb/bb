import { Xy, type KicadSch } from "kicadts";
import type { ParsedSymbolPin } from "./symbols.js";

export interface ParsedNet {
  netName: string;
  nodes: { reference: string; pin: string }[];
}

export type ConnectivityGapKind =
  | "unresolved_label"
  | "unresolved_hierarchical_pin"
  | "unsupported_bus"
  | "missing_pin_geometry";

export interface ConnectivityGap {
  sheetPath: string;
  kind: ConnectivityGapKind;
  detail: string;
  at: { x: number; y: number } | null;
}

export interface HierarchicalLabel {
  name: string;
  at: { x: number; y: number };
}

export interface ChildSheetPin {
  name: string;
  at: { x: number; y: number };
  childSheetPath: string;
}

interface NamedAnchor {
  name: string;
  kind: "local" | "global" | "hierarchical";
}

export interface SheetConnectivityGroup {
  id: string;
  sheetPath: string;
  nodes: Array<{ reference: string; pin: string }>;
  names: NamedAnchor[];
  childPins: ChildSheetPin[];
}

export interface SheetConnectivity {
  groups: SheetConnectivityGroup[];
  gaps: ConnectivityGap[];
}

interface Point {
  x: number;
  y: number;
}

interface Anchor {
  point: Point;
  node: { reference: string; pin: string } | null;
  name: NamedAnchor | null;
  childPin: ChildSheetPin | null;
  noConnect: boolean;
}

class DisjointSet {
  readonly #parent: number[];

  constructor(size: number) {
    this.#parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    const parent = this.#parent[index];
    if (parent === undefined) throw new Error("KICAD_CONNECTIVITY_INDEX_INVALID");
    if (parent === index) return index;
    const root = this.find(parent);
    this.#parent[index] = root;
    return root;
  }

  union(left: number, right: number): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) this.#parent[rightRoot] = leftRoot;
  }
}

const EPSILON = 1e-5;

function pointKey(point: Point): string {
  return `${Math.round(point.x / EPSILON)},${Math.round(point.y / EPSILON)}`;
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const cross = (point.x - start.x) * (end.y - start.y) -
    (point.y - start.y) * (end.x - start.x);
  if (Math.abs(cross) > EPSILON) return false;
  const dot = (point.x - start.x) * (end.x - start.x) +
    (point.y - start.y) * (end.y - start.y);
  if (dot < -EPSILON) return false;
  const squaredLength = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= squaredLength + EPSILON;
}

function distanceAlong(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? (point.x - start.x) / (Math.abs(dx) < EPSILON ? 1 : dx)
    : (point.y - start.y) / (Math.abs(dy) < EPSILON ? 1 : dy);
}

function wireSegments(schematic: KicadSch): Array<[Point, Point]> {
  const segments: Array<[Point, Point]> = [];
  for (const wire of schematic.wires) {
    const points = (wire.points?.points ?? []).filter((point): point is Xy => point instanceof Xy);
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      if (start && end) segments.push([start, end]);
    }
  }
  return segments;
}

function addAnchor(anchors: Anchor[], anchor: Anchor): void {
  anchors.push(anchor);
}

export function extractSheetConnectivity(input: {
  sheetPath: string;
  schematic: KicadSch;
  symbolPins: ParsedSymbolPin[];
  hierarchicalLabels: HierarchicalLabel[];
  childSheetPins: ChildSheetPin[];
}): SheetConnectivity {
  const anchors: Anchor[] = [];
  const segments = wireSegments(input.schematic);
  for (const [start, end] of segments) {
    for (const point of [start, end]) {
      addAnchor(anchors, { point, node: null, name: null, childPin: null, noConnect: false });
    }
  }
  for (const junction of input.schematic.junctions) {
    if (junction.at) addAnchor(anchors, {
      point: junction.at, node: null, name: null, childPin: null, noConnect: false,
    });
  }
  for (const pin of input.symbolPins) addAnchor(anchors, {
    point: pin.at,
    node: { reference: pin.reference, pin: pin.pin },
    name: null,
    childPin: null,
    noConnect: false,
  });
  for (const label of input.schematic.labels) {
    if (label.at) addAnchor(anchors, {
      point: label.at,
      node: null,
      name: { name: label.value, kind: "local" },
      childPin: null,
      noConnect: false,
    });
  }
  for (const label of input.schematic.globalLabels) {
    if (label.at) addAnchor(anchors, {
      point: label.at,
      node: null,
      name: { name: label.value, kind: "global" },
      childPin: null,
      noConnect: false,
    });
  }
  for (const label of input.hierarchicalLabels) addAnchor(anchors, {
    point: label.at,
    node: null,
    name: { name: label.name, kind: "hierarchical" },
    childPin: null,
    noConnect: false,
  });
  for (const pin of input.childSheetPins) addAnchor(anchors, {
    point: pin.at,
    node: null,
    name: { name: pin.name, kind: "hierarchical" },
    childPin: pin,
    noConnect: false,
  });
  for (const noConnect of input.schematic.noConnects) {
    if (noConnect.at) addAnchor(anchors, {
      point: noConnect.at,
      node: null,
      name: null,
      childPin: null,
      noConnect: true,
    });
  }

  const sets = new DisjointSet(anchors.length);
  const firstAtPoint = new Map<string, number>();
  anchors.forEach((anchor, index) => {
    const key = pointKey(anchor.point);
    const first = firstAtPoint.get(key);
    if (first === undefined) firstAtPoint.set(key, index);
    else sets.union(first, index);
  });
  for (const [start, end] of segments) {
    const onSegment = anchors
      .map((anchor, index) => ({ anchor, index }))
      .filter(({ anchor }) => pointOnSegment(anchor.point, start, end))
      .sort((left, right) =>
        distanceAlong(left.anchor.point, start, end) - distanceAlong(right.anchor.point, start, end));
    for (let index = 1; index < onSegment.length; index += 1) {
      const previous = onSegment[index - 1];
      const current = onSegment[index];
      if (previous && current) sets.union(previous.index, current.index);
    }
  }

  const grouped = new Map<number, Anchor[]>();
  anchors.forEach((anchor, index) => {
    const root = sets.find(index);
    const group = grouped.get(root) ?? [];
    group.push(anchor);
    grouped.set(root, group);
  });

  const groups: SheetConnectivityGroup[] = [];
  const gaps: ConnectivityGap[] = [];
  let groupIndex = 0;
  for (const anchorsInGroup of grouped.values()) {
    const nodes = anchorsInGroup.flatMap((anchor) => anchor.node ? [anchor.node] : []);
    const names = anchorsInGroup.flatMap((anchor) => anchor.name ? [anchor.name] : []);
    const childPins = anchorsInGroup.flatMap((anchor) => anchor.childPin ? [anchor.childPin] : []);
    if (nodes.length === 0 && names.length === 0 && childPins.length === 0) continue;
    const uniqueNodes = [...new Map(nodes.map((node) => [`${node.reference}\0${node.pin}`, node])).values()];
    groups.push({
      id: `${input.sheetPath}\0${groupIndex}`,
      sheetPath: input.sheetPath,
      nodes: uniqueNodes,
      names,
      childPins,
    });
    groupIndex += 1;
    if (
      uniqueNodes.length > 0 && names.length === 0 &&
      !anchorsInGroup.some((anchor) => anchor.noConnect)
    ) {
      gaps.push({
        sheetPath: input.sheetPath,
        kind: "unresolved_label",
        detail: `Connected pins ${uniqueNodes.map((node) => `${node.reference}.${node.pin}`).join(", ")} have no source-defined net name`,
        at: anchorsInGroup[0]?.point ?? null,
      });
    }
  }
  return { groups, gaps };
}

function uniqueNames(
  groups: SheetConnectivityGroup[],
  kind: NamedAnchor["kind"],
): string[] {
  return [...new Set(groups.flatMap((group) =>
    group.names.filter((name) => name.kind === kind).map((name) => name.name.trim())
      .filter((name) => name.length > 0)))].sort();
}

export function mergeProjectConnectivity(
  sheets: SheetConnectivity[],
): { nets: ParsedNet[]; gaps: ConnectivityGap[] } {
  const groups = sheets.flatMap((sheet) => sheet.groups);
  const gaps = sheets.flatMap((sheet) => sheet.gaps);
  const groupIndex = new Map(groups.map((group, index) => [group.id, index]));
  const sets = new DisjointSet(groups.length);

  const globalGroups = new Map<string, number>();
  const sheetNamedGroups = new Map<string, number>();
  groups.forEach((group, index) => {
    for (const name of group.names) {
      const namedGroups = name.kind === "global" ? globalGroups : sheetNamedGroups;
      const key = name.kind === "global" ? name.name : `${group.sheetPath}\0${name.name}`;
      const existing = namedGroups.get(key);
      if (existing === undefined) namedGroups.set(key, index);
      else sets.union(existing, index);
    }
  });

  groups.forEach((group, index) => {
    for (const childPin of group.childPins) {
      const matches = groups.filter((candidate) =>
        candidate.sheetPath === childPin.childSheetPath && candidate.names.some((name) =>
          name.kind === "hierarchical" && name.name === childPin.name));
      if (matches.length !== 1) {
        gaps.push({
          sheetPath: group.sheetPath,
          kind: "unresolved_hierarchical_pin",
          detail: `Sheet pin ${childPin.name} targeting ${childPin.childSheetPath} matched ${matches.length} child labels`,
          at: childPin.at,
        });
        continue;
      }
      const matchIndex = groupIndex.get(matches[0]?.id ?? "");
      if (matchIndex !== undefined) sets.union(index, matchIndex);
    }
  });

  const merged = new Map<number, SheetConnectivityGroup[]>();
  groups.forEach((group, index) => {
    const root = sets.find(index);
    const entries = merged.get(root) ?? [];
    entries.push(group);
    merged.set(root, entries);
  });

  const resolved: ParsedNet[] = [];
  for (const mergedGroups of merged.values()) {
    const nodes = [...new Map(mergedGroups.flatMap((group) => group.nodes)
      .map((node) => [`${node.reference}\0${node.pin}`, node])).values()];
    if (nodes.length === 0) continue;
    const globalNames = uniqueNames(mergedGroups, "global");
    const localNames = uniqueNames(mergedGroups, "local");
    const hierarchicalNames = uniqueNames(mergedGroups, "hierarchical");
    const candidates = globalNames.length > 0 ? globalNames
      : localNames.length > 0 ? localNames
      : hierarchicalNames;
    if (candidates.length === 0) continue;
    if (candidates.length !== 1) {
      gaps.push({
        sheetPath: mergedGroups[0]?.sheetPath ?? "<unknown>",
        kind: "unresolved_label",
        detail: `A connected component has conflicting source-defined names: ${candidates.join(", ")}`,
        at: null,
      });
      continue;
    }
    resolved.push({ netName: candidates[0] ?? "", nodes });
  }

  const byName = new Map<string, ParsedNet[]>();
  for (const net of resolved) {
    const entries = byName.get(net.netName) ?? [];
    entries.push(net);
    byName.set(net.netName, entries);
  }
  const nets: ParsedNet[] = [];
  for (const [netName, entries] of byName) {
    if (entries.length > 1) {
      const firstNode = entries[0]?.nodes[0];
      const sourceGroup = firstNode === undefined ? undefined : groups.find((group) =>
        group.nodes.some((node) => node.reference === firstNode.reference && node.pin === firstNode.pin));
      if (sourceGroup === undefined) {
        throw new Error(`KICAD_CONNECTIVITY_INVARIANT: no source sheet for net ${netName}`);
      }
      gaps.push({
        sheetPath: sourceGroup.sheetPath,
        kind: "unresolved_label",
        detail: `Local net name ${netName} occurs in ${entries.length} disconnected components and cannot fit the project-wide net key honestly`,
        at: null,
      });
      continue;
    }
    const net = entries[0];
    if (net) nets.push(net);
  }
  nets.sort((left, right) => left.netName.localeCompare(right.netName, undefined, { numeric: true }));
  for (const net of nets) net.nodes.sort((left, right) =>
    left.reference.localeCompare(right.reference, undefined, { numeric: true }) ||
    left.pin.localeCompare(right.pin, undefined, { numeric: true }));
  return { nets, gaps };
}
