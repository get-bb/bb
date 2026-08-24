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
 *   { "reshaped": { "from": Shape, "to": Shape, "fields"?: string[] } }
 *                             a matched row whose kind/workKind changed;
 *                             with `fields`, the other fields that changed
 *                             must be within it
 *   { "moved": Shape }        a row that left one nesting level and appeared
 *                             at another
 *   { "resegmented": Shape }  an identity the two sides project a different
 *                             number of times (a turn split into fewer
 *                             visible segments)
 *   { "pageField": { "field" } }
 *                             a page-level field beside `rows` (pendingTodos,
 *                             goal, activePromptMode, …) whose value changed
 * and Shape narrows by `kind`, `workKind`, `role` and `nested` (whether the
 * row id carries a `:child:` prefix).
 *
 * Container fields (`children`, `childRows`) are recursed into, never
 * compared as values. A turn whose only changed fields are its bounds
 * (`summaryCount`, `sourceSeq*`, timestamps) is reported under the built-in
 * `container-bounds` class when a child of that turn changed. A turn's
 * `status` is not a bound: it passes through from the turn event, so a
 * status change must be claimed by a class of its own.
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
  z
    .object({
      reshaped: z
        .object({
          from: shapeSchema,
          to: shapeSchema,
          fields: z.array(z.string()).min(1).optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ moved: shapeSchema }).strict(),
  z.object({ resegmented: shapeSchema }).strict(),
  z.object({ pageField: z.object({ field: z.string().min(1) }).strict() }).strict(),
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
      /** The changed fields beside `kind`/`workKind`, sorted. */
      fields: string[];
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
    }
  | {
      type: "pageField";
      thread: string;
      id: string;
      field: string;
      before: unknown;
      after: unknown;
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
    const allowed = m.reshaped.fields;
    return (
      change.type === "reshaped" &&
      matchesShape(m.reshaped.from, change.before) &&
      matchesShape(m.reshaped.to, change.after) &&
      (allowed === undefined || change.fields.every((field) => allowed.includes(field)))
    );
  }
  if ("moved" in m) {
    return change.type === "moved" && matchesShape(m.moved, change.after);
  }
  if ("pageField" in m) {
    return change.type === "pageField" && change.field === m.pageField.field;
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
      return `reshaped ${rowShape(change.before)} → ${rowShape(change.after)} [${change.fields.join(",")}]`;
    case "resegmented": {
      const sample = change.after[0] ?? change.before[0];
      return `resegmented ${sample ? rowShape(sample) : "?"} ${change.before.length}→${change.after.length}`;
    }
    case "pageField":
      return `changed page.${change.field}`;
    default:
      return `${change.type} ${rowShape(change.type === "moved" ? change.after : change.row)}`;
  }
}

export interface RowDiffReport {
  /** Changes per class name, including the built-in `container-bounds`. */
  claims: Map<string, number>;
  /**
   * The entries of the class list that claimed at least one change, by
   * index. A class file may spread one name over several matchers, so
   * liveness is tracked per entry, not per name: every report merged into
   * another must come from the same class list.
   */
  claimedEntries: Set<number>;
  /** One representative change per class, for the run log. */
  examples: Map<string, RowChange>;
  /**
   * Which child classes explain the `container-bounds` claims: a turn whose
   * bounds moved counts once under every class its changed children fell
   * into, so the reader can tell which side of the ledger the bounds
   * changes belong to.
   */
  containerBoundsBy: Map<string, number>;
  unclassified: RowChange[];
}

export function createRowDiffReport(): RowDiffReport {
  return {
    claims: new Map(),
    claimedEntries: new Set(),
    examples: new Map(),
    containerBoundsBy: new Map(),
    unclassified: [],
  };
}

export function mergeRowDiffReport(into: RowDiffReport, from: RowDiffReport): void {
  for (const [name, count] of from.claims) {
    into.claims.set(name, (into.claims.get(name) ?? 0) + count);
  }
  for (const index of from.claimedEntries) into.claimedEntries.add(index);
  for (const [name, count] of from.containerBoundsBy) {
    into.containerBoundsBy.set(name, (into.containerBoundsBy.get(name) ?? 0) + count);
  }
  for (const [name, example] of from.examples) {
    if (!into.examples.has(name)) into.examples.set(name, example);
  }
  into.unclassified.push(...from.unclassified);
}

interface SharedThreadState {
  turnsWithChildChanges: Set<string>;
  /** The classes the changed children of each turn fell into. */
  turnChildClasses: Map<string, Set<string>>;
  movedRows: Map<string, SnapshotRow>;
}

/** A row pooled for later pairing, with the turns it was nested under. */
interface PooledRow {
  row: SnapshotRow;
  turns: string[];
}

interface VariantDiff {
  thread: string;
  classes: readonly RowDiffClass[];
  report: RowDiffReport;
  removed: Map<string, PooledRow[]>;
  added: Map<string, PooledRow[]>;
  shared: SharedThreadState;
  /** The turn ids whose children are being diffed right now (outermost first). */
  turnStack: string[];
  /** Bounds-only turn changes awaiting attribution (see claimContainerBounds). */
  pendingBounds: { turnId: string | undefined; change: RowChange }[];
}

function claim(diff: VariantDiff, name: string, change: RowChange): void {
  diff.report.claims.set(name, (diff.report.claims.get(name) ?? 0) + 1);
  if (!diff.report.examples.has(name)) diff.report.examples.set(name, change);
  for (const turnId of diff.turnStack) {
    let classes = diff.shared.turnChildClasses.get(turnId);
    if (!classes) {
      classes = new Set();
      diff.shared.turnChildClasses.set(turnId, classes);
    }
    classes.add(name);
  }
}

function classify(diff: VariantDiff, change: RowChange): void {
  const index = diff.classes.findIndex((candidate) => classMatches(candidate, change));
  const cls = diff.classes[index];
  if (cls) {
    diff.report.claimedEntries.add(index);
    claim(diff, cls.name, change);
  } else {
    diff.report.unclassified.push(change);
    for (const turnId of diff.turnStack) {
      let classes = diff.shared.turnChildClasses.get(turnId);
      if (!classes) {
        classes = new Set();
        diff.shared.turnChildClasses.set(turnId, classes);
      }
      classes.add("(unclassified)");
    }
  }
}

/**
 * Bounds claims are attributed after the variant settles: a child that was
 * pooled (added or removed) is classified only then, and the turn's bounds
 * follow that child.
 */
function claimContainerBounds(diff: VariantDiff, turnId: string | undefined, change: RowChange): void {
  diff.pendingBounds.push({ turnId, change });
}

function settleContainerBounds(diff: VariantDiff): void {
  for (const { turnId, change } of diff.pendingBounds) {
    claim(diff, CONTAINER_BOUNDS_CLASS, change);
    const causes = turnId === undefined ? undefined : diff.shared.turnChildClasses.get(turnId);
    for (const name of causes ?? ["(unknown)"]) {
      diff.report.containerBoundsBy.set(name, (diff.report.containerBoundsBy.get(name) ?? 0) + 1);
    }
  }
  diff.pendingBounds = [];
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

function pool(diff: VariantDiff, map: Map<string, PooledRow[]>, id: string, row: SnapshotRow): void {
  const entry = { row, turns: [...diff.turnStack] };
  const rows = map.get(id);
  if (rows) rows.push(entry);
  else map.set(id, [entry]);
}

function groupByIdentity(rows: readonly SnapshotRow[]): Map<string, SnapshotRow[]> {
  const groups = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const id = rowIdentity(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

/** Runs `fn` with the turn stack a pooled row was collected under. */
function underTurns<T>(diff: VariantDiff, turns: string[], fn: () => T): T {
  const saved = diff.turnStack;
  diff.turnStack = turns;
  try {
    return fn();
  } finally {
    diff.turnStack = saved;
  }
}

function diffRow(diff: VariantDiff, b: SnapshotRow, a: SnapshotRow, id: string): number {
  const { thread } = diff;
  const reshaped = rowShape(a) !== rowShape(b);
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
  if (reshaped) {
    // The shape change is the matcher's from/to; the rest of the changed
    // field set is what a class's `fields` may restrict.
    classify(diff, {
      type: "reshaped",
      thread,
      id,
      before: b,
      after: a,
      fields: fields.filter((field) => field !== "kind" && field !== "workKind"),
    });
  }
  const turnId = b.kind === "turn" ? str(b.turnId) : undefined;
  if (turnId !== undefined) diff.turnStack.push(turnId);
  const nestedChanges = diffRows(diff, childRowsOf([b]), childRowsOf([a]));
  if (turnId !== undefined) diff.turnStack.pop();
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
      claimContainerBounds(diff, turnId, {
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
      for (const b of bs) pool(diff, diff.removed, id, b);
      changes += bs.length;
      continue;
    }
    if (bs.length !== as.length) {
      const turnId = as[0]?.kind === "turn" ? str(as[0].turnId) : undefined;
      if (turnId !== undefined) diff.turnStack.push(turnId);
      classify(diff, { type: "resegmented", thread, id, before: bs, after: as });
      changes += 1 + diffRows(diff, childRowsOf(bs), childRowsOf(as));
      if (turnId !== undefined) {
        diff.turnStack.pop();
        diff.shared.turnsWithChildChanges.add(turnId);
      }
      continue;
    }
    for (let index = 0; index < bs.length; index += 1) {
      changes += diffRow(diff, bs[index] as SnapshotRow, as[index] as SnapshotRow, id);
    }
  }
  for (const [id, as] of afterById) {
    if (beforeById.has(id)) continue;
    for (const a of as) pool(diff, diff.added, id, a);
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
        const b = removedRows[index] as PooledRow;
        const a = addedRows[index] as PooledRow;
        shared.movedRows.set(id, a.row);
        // A move belongs to the turn it arrived in.
        underTurns(diff, a.turns, () => {
          classify(diff, { type: "moved", thread, id, before: b.row, after: a.row });
          diffRows(diff, childRowsOf([b.row]), childRowsOf([a.row]));
        });
      }
      for (const b of removedRows.slice(pairs)) {
        underTurns(diff, b.turns, () =>
          classify(diff, { type: "removed", thread, id, row: b.row }),
        );
      }
      for (const a of addedRows.slice(pairs)) {
        underTurns(diff, a.turns, () =>
          classify(diff, { type: "added", thread, id, row: a.row }),
        );
      }
      continue;
    }
    const movedTo = shared.movedRows.get(id);
    for (const b of removedRows) {
      underTurns(diff, b.turns, () => {
        if (movedTo) {
          classify(diff, { type: "moved", thread, id, before: b.row, after: movedTo });
        } else {
          classify(diff, { type: "removed", thread, id, row: b.row });
        }
      });
    }
  }
  for (const [id, addedRows] of added) {
    for (const a of addedRows) {
      underTurns(diff, a.turns, () =>
        classify(diff, { type: "added", thread, id, row: a.row }),
      );
    }
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
    turnChildClasses: new Map(),
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
      turnStack: [],
      pendingBounds: [],
    };
    changes += diffRows(diff, variantRows(before, variant), variantRows(after, variant));
    settleVariantDiff(diff);
    settleContainerBounds(diff);
    changes += diffPageFields(diff, before, after, variant);
  }
  return changes;
}

/**
 * Everything on a page beside `rows` (pendingTodos, goal, activePromptMode,
 * …) is compared whole: a class file must claim those too, or the gate
 * would pass a projection change that only touched the banner state.
 */
function diffPageFields(
  diff: VariantDiff,
  before: RowSnapshotVariants,
  after: RowSnapshotVariants,
  variant: string,
): number {
  const beforePages = before.variants?.[variant]?.pages ?? [];
  const afterPages = after.variants?.[variant]?.pages ?? [];
  let changes = 0;
  const pages = Math.max(beforePages.length, afterPages.length);
  for (let index = 0; index < pages; index += 1) {
    const b = (beforePages[index] ?? {}) as Record<string, unknown>;
    const a = (afterPages[index] ?? {}) as Record<string, unknown>;
    for (const field of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (field === "rows") continue;
      if (JSON.stringify(b[field]) === JSON.stringify(a[field])) continue;
      changes += 1;
      classify(diff, {
        type: "pageField",
        thread: diff.thread,
        id: `page:${index}:${field}`,
        field,
        before: b[field],
        after: a[field],
      });
    }
  }
  return changes;
}

/**
 * The entries that claimed nothing: stale entries or wrong matchers. Judged
 * per entry, not per name, so a matcher that never fires cannot hide behind
 * a sibling that shares its name. A unique name is reported as is; a shared
 * one as `name#index` with its matcher, so the reader can tell which entry
 * is dead.
 */
export function idleRowDiffClasses(
  classes: readonly RowDiffClass[],
  report: RowDiffReport,
): string[] {
  const sharedNames = new Set(
    classes
      .filter((cls, index) => classes.findIndex((other) => other.name === cls.name) !== index)
      .map((cls) => cls.name),
  );
  return classes.flatMap((cls, index) =>
    report.claimedEntries.has(index)
      ? []
      : [sharedNames.has(cls.name) ? `${cls.name}#${index} ${JSON.stringify(cls.match)}` : cls.name],
  );
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
  if (report.containerBoundsBy.size > 0) {
    lines.push(
      `  ${CONTAINER_BOUNDS_CLASS} by child class: ${[...report.containerBoundsBy]
        .sort((x, y) => y[1] - x[1])
        .map(([name, count]) => `${name} ${count}`)
        .join(", ")}`,
    );
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
