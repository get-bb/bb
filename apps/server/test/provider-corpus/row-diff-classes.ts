/**
 * Identity-based classification of row-snapshot changes.
 *
 * The pointer diff in `corpus-harness.ts` is exact for field-level changes
 * but useless when a projection change ADDS or REMOVES rows: every later
 * sibling shifts and the diff reports the whole turn. This engine matches
 * rows by identity instead (`callId`, `itemId`, `interactionId`, the turn id,
 * or the row id) and buckets each change into a named class from a JSON
 * file the PR carries. A change no class claims fails the gate, so a PR
 * that intentionally changes rows proves its change is exactly the classes
 * it named and nothing else.
 *
 * Class file shape (see `allowlists/README.md`):
 *   { "name", "reason", "match": Matcher }[]
 * where Matcher is exactly one of
 *   { "added": Shape }        a row only the candidate has
 *   { "removed": Shape }      a row only the baseline has
 *   { "changed": Shape & { "fields": string[] } }
 *                             a matched row whose changed field set is within
 *                             `fields` (`id:prefix` stands for an id whose
 *                             only difference is the nesting prefix)
 *   { "reshaped": { "from": Shape, "to": Shape } }
 *                             a matched row whose kind/workKind changed
 *   { "moved": Shape }        a row that left one nesting level and appeared
 *                             at another
 *   { "resegmented": Shape }  an identity the two sides project a different
 *                             number of times (a turn split into fewer
 *                             visible segments)
 * and Shape narrows by `kind`, `workKind`, `role` and `nested` (whether the
 * row id carries a `:child:` prefix).
 *
 * Container fields (`children`, `childRows`) are recursed into, never
 * compared as values. A turn whose only changed fields are its bounds
 * (`summaryCount`, `sourceSeq*`, timestamps, status) is reported under the
 * built-in `container-bounds` class when a child of that turn changed.
 */
import fs from "node:fs";
import { z } from "zod";
import { resolveRepoRelativeFile } from "./env-file-path.js";

const shapeSchema = z
  .object({
    kind: z.string().optional(),
    workKind: z.string().optional(),
    role: z.string().optional(),
    nested: z.boolean().optional(),
  })
  .strict();
export type RowShapeSpec = z.infer<typeof shapeSchema>;

const matcherSchema = z.union([
  z.object({ added: shapeSchema }).strict(),
  z.object({ removed: shapeSchema }).strict(),
  z
    .object({
      changed: shapeSchema.extend({ fields: z.array(z.string()).min(1) }),
    })
    .strict(),
  z.object({ reshaped: z.object({ from: shapeSchema, to: shapeSchema }) }).strict(),
  z.object({ moved: shapeSchema }).strict(),
  z.object({ resegmented: shapeSchema }).strict(),
]);

const rowClassSchema = z
  .object({
    name: z.string().min(1),
    reason: z.string().min(1),
    match: matcherSchema,
  })
  .strict();
export type RowDiffClass = z.infer<typeof rowClassSchema>;

export const ROW_CLASSES_FILE_ENV = "BB_PROVIDER_CORPUS_ROW_CLASSES";

export function readRowDiffClasses(filePath: string): RowDiffClass[] {
  return z.array(rowClassSchema).parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function resolveRowDiffClassesPath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[ROW_CLASSES_FILE_ENV];
  return value === undefined || value === ""
    ? null
    : resolveRepoRelativeFile(ROW_CLASSES_FILE_ENV, value);
}

/** A timeline row as the snapshot stores it: a JSON object we read loosely. */
export type SnapshotRow = Record<string, unknown>;

export interface RowSnapshotVariants {
  variants?: Record<string, { pages?: { rows?: SnapshotRow[] }[] } | undefined>;
}

export type RowChange =
  | { type: "added"; thread: string; id: string; row: SnapshotRow }
  | { type: "removed"; thread: string; id: string; row: SnapshotRow }
  | {
      type: "changed";
      thread: string;
      id: string;
      before: SnapshotRow;
      after: SnapshotRow;
      fields: string[];
    }
  | {
      type: "reshaped";
      thread: string;
      id: string;
      before: SnapshotRow;
      after: SnapshotRow;
    }
  | {
      type: "moved";
      thread: string;
      id: string;
      before: SnapshotRow;
      after: SnapshotRow;
    }
  | {
      type: "resegmented";
      thread: string;
      id: string;
      before: SnapshotRow[];
      after: SnapshotRow[];
    };

export const CONTAINER_BOUNDS_CLASS = "container-bounds";

const CONTAINER_FIELDS = ["children", "childRows"] as const;
const CONTAINER_BOUND_FIELDS = new Set([
  "summaryCount",
  "sourceSeqEnd",
  "sourceSeqStart",
  "completedAt",
  "createdAt",
  "startedAt",
  "status",
]);

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * A row nested under a delegation carries its parent's id as a prefix
 * (`<delegation-row-id>:child:<own-id>`); the own id is the stable part,
 * because a change to how the parent row is identified re-prefixes every
 * descendant.
 */
function ownRowId(id: string): string {
  const marker = ":child:";
  const index = id.lastIndexOf(marker);
  return index === -1 ? id : id.slice(index + marker.length);
}

export function rowIdentity(row: SnapshotRow): string {
  const id = str(row.id) ?? "";
  if (row.kind === "work") {
    const key = str(row.callId) ?? str(row.itemId) ?? str(row.interactionId);
    if (key !== undefined) return `work:${key}`;
  }
  if (row.kind === "turn") return `turn:${str(row.turnId) ?? id}`;
  return `${String(row.kind)}:${ownRowId(id)}`;
}

export function rowShape(row: SnapshotRow): string {
  return row.kind === "work"
    ? `${String(row.kind)}/${String(row.workKind)}`
    : String(row.kind);
}

function matchesShape(spec: RowShapeSpec | undefined, row: SnapshotRow): boolean {
  if (!spec) return true;
  if (spec.kind !== undefined && row.kind !== spec.kind) return false;
  if (spec.workKind !== undefined && row.workKind !== spec.workKind) return false;
  if (spec.role !== undefined && row.role !== spec.role) return false;
  if (
    spec.nested !== undefined &&
    (str(row.id) ?? "").includes(":child:") !== spec.nested
  ) {
    return false;
  }
  return true;
}

function classMatches(cls: RowDiffClass, change: RowChange): boolean {
  const m = cls.match;
  if ("added" in m) {
    return change.type === "added" && matchesShape(m.added, change.row);
  }
  if ("removed" in m) {
    return change.type === "removed" && matchesShape(m.removed, change.row);
  }
  if ("changed" in m) {
    return (
      change.type === "changed" &&
      matchesShape(m.changed, change.after) &&
      change.fields.every((field) => m.changed.fields.includes(field))
    );
  }
  if ("reshaped" in m) {
    return (
      change.type === "reshaped" &&
      matchesShape(m.reshaped.from, change.before) &&
      matchesShape(m.reshaped.to, change.after)
    );
  }
  if ("moved" in m) {
    return change.type === "moved" && matchesShape(m.moved, change.after);
  }
  return (
    change.type === "resegmented" &&
    change.after.length > 0 &&
    matchesShape(m.resegmented, change.after[0] as SnapshotRow)
  );
}

export function describeRowChange(change: RowChange): string {
  switch (change.type) {
    case "changed":
      return `changed ${rowShape(change.after)} [${change.fields.join(",")}]`;
    case "reshaped":
      return `reshaped ${rowShape(change.before)} → ${rowShape(change.after)}`;
    case "resegmented": {
      const sample = change.after[0] ?? change.before[0];
      return `resegmented ${sample ? rowShape(sample) : "?"} ${change.before.length}→${change.after.length}`;
    }
    default:
      return `${change.type} ${rowShape(change.type === "moved" ? change.after : change.row)}`;
  }
}

export interface RowDiffReport {
  /** Changes per class name, including the built-in `container-bounds`. */
  claims: Map<string, number>;
  /** One representative change per class, for the run log. */
  examples: Map<string, RowChange>;
  unclassified: RowChange[];
}

export function createRowDiffReport(): RowDiffReport {
  return { claims: new Map(), examples: new Map(), unclassified: [] };
}

interface SharedThreadState {
  turnsWithChildChanges: Set<string>;
  movedRows: Map<string, SnapshotRow>;
}

interface VariantDiff {
  thread: string;
  classes: readonly RowDiffClass[];
  report: RowDiffReport;
  removed: Map<string, SnapshotRow[]>;
  added: Map<string, SnapshotRow[]>;
  shared: SharedThreadState;
}

function claim(diff: VariantDiff, name: string, change: RowChange): void {
  diff.report.claims.set(name, (diff.report.claims.get(name) ?? 0) + 1);
  if (!diff.report.examples.has(name)) diff.report.examples.set(name, change);
}

function classify(diff: VariantDiff, change: RowChange): void {
  const cls = diff.classes.find((candidate) => classMatches(candidate, change));
  if (cls) claim(diff, cls.name, change);
  else diff.report.unclassified.push(change);
}

function childRowsOf(rows: readonly SnapshotRow[]): SnapshotRow[] {
  const children: SnapshotRow[] = [];
  for (const row of rows) {
    for (const key of CONTAINER_FIELDS) {
      const value = row[key];
      if (Array.isArray(value)) children.push(...(value as SnapshotRow[]));
    }
  }
  return children;
}

function hasContainer(row: SnapshotRow): boolean {
  return CONTAINER_FIELDS.some((key) => Array.isArray(row[key]));
}

function pool(map: Map<string, SnapshotRow[]>, id: string, row: SnapshotRow): void {
  const rows = map.get(id);
  if (rows) rows.push(row);
  else map.set(id, [row]);
}

function groupByIdentity(rows: readonly SnapshotRow[]): Map<string, SnapshotRow[]> {
  const groups = new Map<string, SnapshotRow[]>();
  for (const row of rows) pool(groups, rowIdentity(row), row);
  return groups;
}

function diffRow(diff: VariantDiff, b: SnapshotRow, a: SnapshotRow, id: string): number {
  const { thread } = diff;
  const reshaped = rowShape(a) !== rowShape(b);
  if (reshaped) {
    classify(diff, { type: "reshaped", thread, id, before: b, after: a });
  }
  const fields: string[] = [];
  let boundsOnly = true;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((CONTAINER_FIELDS as readonly string[]).includes(key)) continue;
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    const aId = str(a.id);
    const bId = str(b.id);
    if (key === "id" && aId !== undefined && bId !== undefined && ownRowId(aId) === ownRowId(bId)) {
      fields.push("id:prefix");
      continue;
    }
    fields.push(key);
    if (!CONTAINER_BOUND_FIELDS.has(key)) boundsOnly = false;
  }
  fields.sort();
  const nestedChanges = diffRows(diff, childRowsOf([b]), childRowsOf([a]));
  const turnId = b.kind === "turn" ? str(b.turnId) : undefined;
  if (nestedChanges > 0 && turnId !== undefined) {
    diff.shared.turnsWithChildChanges.add(turnId);
  }
  let own = reshaped ? 1 : 0;
  if (fields.length > 0 && !reshaped) {
    const explainedByChildren =
      nestedChanges > 0 ||
      (turnId !== undefined &&
        !hasContainer(b) &&
        diff.shared.turnsWithChildChanges.has(turnId));
    if (boundsOnly && explainedByChildren) {
      claim(diff, CONTAINER_BOUNDS_CLASS, {
        type: "changed",
        thread,
        id,
        before: b,
        after: a,
        fields,
      });
    } else {
      classify(diff, { type: "changed", thread, id, before: b, after: a, fields });
      own = 1;
    }
  }
  return nestedChanges + own;
}

function diffRows(
  diff: VariantDiff,
  before: readonly SnapshotRow[],
  after: readonly SnapshotRow[],
): number {
  const { thread } = diff;
  const beforeById = groupByIdentity(before);
  const afterById = groupByIdentity(after);
  let changes = 0;
  for (const [id, bs] of beforeById) {
    const as = afterById.get(id);
    if (as === undefined) {
      for (const b of bs) pool(diff.removed, id, b);
      changes += bs.length;
      continue;
    }
    if (bs.length !== as.length) {
      classify(diff, { type: "resegmented", thread, id, before: bs, after: as });
      changes += 1 + diffRows(diff, childRowsOf(bs), childRowsOf(as));
      const turnId = as[0]?.kind === "turn" ? str(as[0].turnId) : undefined;
      if (turnId !== undefined) diff.shared.turnsWithChildChanges.add(turnId);
      continue;
    }
    for (let index = 0; index < bs.length; index += 1) {
      changes += diffRow(diff, bs[index] as SnapshotRow, as[index] as SnapshotRow, id);
    }
  }
  for (const [id, as] of afterById) {
    if (beforeById.has(id)) continue;
    for (const a of as) pool(diff.added, id, a);
    changes += as.length;
  }
  return changes;
}

/**
 * Pairs the variant's pooled removals and additions by identity: a pair is
 * one "moved" change. The default variant carries no turn children, so a
 * row the nested variant showed moving INTO a turn is simply absent there —
 * the same move, looked up through the shared per-thread state.
 */
function settleVariantDiff(diff: VariantDiff): void {
  const { thread, removed, added, shared } = diff;
  for (const [id, removedRows] of removed) {
    const addedRows = added.get(id);
    if (addedRows) {
      added.delete(id);
      const pairs = Math.min(removedRows.length, addedRows.length);
      for (let index = 0; index < pairs; index += 1) {
        const b = removedRows[index] as SnapshotRow;
        const a = addedRows[index] as SnapshotRow;
        shared.movedRows.set(id, a);
        classify(diff, { type: "moved", thread, id, before: b, after: a });
        diffRows(diff, childRowsOf([b]), childRowsOf([a]));
      }
      for (const b of removedRows.slice(pairs)) {
        classify(diff, { type: "removed", thread, id, row: b });
      }
      for (const a of addedRows.slice(pairs)) {
        classify(diff, { type: "added", thread, id, row: a });
      }
      continue;
    }
    const movedTo = shared.movedRows.get(id);
    for (const b of removedRows) {
      if (movedTo) {
        classify(diff, { type: "moved", thread, id, before: b, after: movedTo });
      } else {
        classify(diff, { type: "removed", thread, id, row: b });
      }
    }
  }
  for (const [id, addedRows] of added) {
    for (const a of addedRows) classify(diff, { type: "added", thread, id, row: a });
  }
}

function variantRows(
  snapshot: RowSnapshotVariants,
  variant: string,
): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  for (const page of snapshot.variants?.[variant]?.pages ?? []) {
    rows.push(...(page.rows ?? []));
  }
  return rows;
}

/**
 * Classifies every change between two snapshots of one thread into
 * `report`. Returns the number of changes found (classified or not).
 */
export function classifyRowSnapshotDiff(
  thread: string,
  before: RowSnapshotVariants,
  after: RowSnapshotVariants,
  classes: readonly RowDiffClass[],
  report: RowDiffReport,
): number {
  // The nested variant is walked first so a turn whose children changed
  // there explains the bounds-only change of the same turn row in the
  // default variant, where turn rows carry no children.
  const variants = [
    ...new Set([
      ...Object.keys(before.variants ?? {}),
      ...Object.keys(after.variants ?? {}),
    ]),
  ].sort((x, y) => (x === "nested" ? -1 : y === "nested" ? 1 : 0));
  const shared: SharedThreadState = {
    turnsWithChildChanges: new Set(),
    movedRows: new Map(),
  };
  let changes = 0;
  for (const variant of variants) {
    const diff: VariantDiff = {
      thread: `${thread}@${variant}`,
      classes,
      report,
      removed: new Map(),
      added: new Map(),
      shared,
    };
    changes += diffRows(diff, variantRows(before, variant), variantRows(after, variant));
    settleVariantDiff(diff);
  }
  return changes;
}

/** Class names that claimed nothing: stale entries or wrong matchers. */
export function idleRowDiffClasses(
  classes: readonly RowDiffClass[],
  report: RowDiffReport,
): string[] {
  return [...new Set(classes.filter((cls) => !report.claims.has(cls.name)).map((cls) => cls.name))];
}

export function formatRowDiffReport(
  classes: readonly RowDiffClass[],
  report: RowDiffReport,
  options: { examples?: boolean } = {},
): string {
  const lines: string[] = [];
  for (const [name, count] of [...report.claims].sort((x, y) => y[1] - x[1])) {
    const cls = classes.find((candidate) => candidate.name === name);
    lines.push(`  ${count.toString().padStart(6)}  ${name}${cls ? ` — ${cls.reason}` : ""}`);
    const example = report.examples.get(name);
    if (options.examples && example) {
      lines.push(`          e.g. ${JSON.stringify(example).slice(0, 300)}`);
    }
  }
  const idle = idleRowDiffClasses(classes, report);
  if (idle.length > 0) {
    lines.push(`classes that claimed nothing: ${idle.join(", ")}`);
  }
  if (report.unclassified.length > 0) {
    lines.push(`UNCLASSIFIED: ${report.unclassified.length}`);
    const byShape = new Map<string, number>();
    for (const change of report.unclassified) {
      const key = describeRowChange(change);
      byShape.set(key, (byShape.get(key) ?? 0) + 1);
    }
    for (const [key, count] of [...byShape].sort((x, y) => y[1] - x[1]).slice(0, 40)) {
      lines.push(`  ${count.toString().padStart(6)}  ${key}`);
    }
  }
  return lines.join("\n");
}
