import fs from "node:fs";
import { z } from "zod";
import { resolveRepoRelativeFile } from "./env-file-path.js";

const rowMatcherSchema = z
  .object({
    kind: z.string().optional(),
    workKind: z.string().optional(),
    role: z.string().optional(),
    nested: z.boolean().optional(),
  })
  .strict();
export type RowMatcherSpec = z.infer<typeof rowMatcherSchema>;

const ROW_KIND_CHANGE_KEY: "reshaped" = "reshaped";

const matcherSchema = z.union([
  z.object({ added: rowMatcherSchema }).strict(),
  z.object({ removed: rowMatcherSchema }).strict(),
  z
    .object({
      changed: rowMatcherSchema.extend({ fields: z.array(z.string()).min(1) }),
    })
    .strict(),
  z
    .object({
      [ROW_KIND_CHANGE_KEY]: z
        .object({
          from: rowMatcherSchema,
          to: rowMatcherSchema,
          fields: z.array(z.string()).min(1).optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ moved: rowMatcherSchema }).strict(),
  z.object({ resegmented: rowMatcherSchema }).strict(),
  z
    .object({ pageField: z.object({ field: z.string().min(1) }).strict() })
    .strict(),
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
  return z
    .array(rowClassSchema)
    .parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function resolveRowDiffClassesPath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[ROW_CLASSES_FILE_ENV];
  return value === undefined || value === ""
    ? null
    : resolveRepoRelativeFile(ROW_CLASSES_FILE_ENV, value);
}

export type SnapshotValue =
  | undefined
  | string
  | number
  | boolean
  | null
  | SnapshotValue[]
  | { [key: string]: SnapshotValue };

export interface SnapshotRow {
  [key: string]: SnapshotValue;
}

export interface SnapshotPage extends SnapshotRow {
  rows?: SnapshotRow[];
}

export interface SnapshotVariant {
  pages?: SnapshotPage[];
}

export interface RowSnapshotVariants {
  variants?: Record<string, SnapshotVariant>;
}

const snapshotJsonValueSchema: z.ZodType<SnapshotValue> = z.lazy(() =>
  z.union([
    z.undefined(),
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(snapshotJsonValueSchema),
    z.record(z.string(), snapshotJsonValueSchema),
  ]),
);
const snapshotJsonObjectSchema: z.ZodType<SnapshotRow> = z.record(
  z.string(),
  snapshotJsonValueSchema,
);
const snapshotPageSchema = z
  .object({ rows: z.array(snapshotJsonObjectSchema).optional() })
  .catchall(snapshotJsonValueSchema);
const snapshotVariantSchema = z
  .object({ pages: z.array(snapshotPageSchema).optional() })
  .catchall(snapshotJsonValueSchema);
const rowSnapshotVariantsSchema = z
  .object({ variants: z.record(z.string(), snapshotVariantSchema).optional() })
  .strict();
const EMPTY_PAGE: SnapshotPage = {};

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
      before: SnapshotValue;
      after: SnapshotValue;
    };

export const CONTAINER_BOUNDS_CLASS = "container-bounds";

const CONTAINER_FIELDS = new Set(["children", "childRows"]);
const CONTAINER_BOUND_FIELDS = new Set([
  "summaryCount",
  "sourceSeqEnd",
  "sourceSeqStart",
  "completedAt",
  "createdAt",
  "startedAt",
]);

function stringValue(value: SnapshotValue): string | undefined {
  const parsed = z.string().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function ownRowId(id: string): string {
  const marker = ":child:";
  const index = id.lastIndexOf(marker);
  return index === -1 ? id : id.slice(index + marker.length);
}

export function rowIdentity(row: SnapshotRow): string {
  const id = stringValue(row.id) ?? "";
  if (row.kind === "work") {
    const key =
      stringValue(row.callId) ??
      stringValue(row.itemId) ??
      stringValue(row.interactionId);
    if (key !== undefined) return `work:${key}`;
  }
  if (row.kind === "turn") return `turn:${stringValue(row.turnId) ?? id}`;
  return `${String(row.kind)}:${ownRowId(id)}`;
}

export function rowKindLabel(row: SnapshotRow): string {
  return row.kind === "work"
    ? `${String(row.kind)}/${String(row.workKind)}`
    : String(row.kind);
}

function matchesRowSpec(
  spec: RowMatcherSpec | undefined,
  row: SnapshotRow,
): boolean {
  if (!spec) return true;
  if (spec.kind !== undefined && row.kind !== spec.kind) return false;
  if (spec.workKind !== undefined && row.workKind !== spec.workKind)
    return false;
  if (spec.role !== undefined && row.role !== spec.role) return false;
  if (
    spec.nested !== undefined &&
    (stringValue(row.id) ?? "").includes(":child:") !== spec.nested
  ) {
    return false;
  }
  return true;
}

function classMatches(cls: RowDiffClass, change: RowChange): boolean {
  const m = cls.match;
  if ("added" in m) {
    return change.type === "added" && matchesRowSpec(m.added, change.row);
  }
  if ("removed" in m) {
    return change.type === "removed" && matchesRowSpec(m.removed, change.row);
  }
  if ("changed" in m) {
    return (
      change.type === "changed" &&
      matchesRowSpec(m.changed, change.after) &&
      change.fields.every((field) => m.changed.fields.includes(field))
    );
  }
  if ("reshaped" in m) {
    const kindChangeMatcher = m[ROW_KIND_CHANGE_KEY];
    const allowed = kindChangeMatcher.fields;
    return (
      change.type === "reshaped" &&
      matchesRowSpec(kindChangeMatcher.from, change.before) &&
      matchesRowSpec(kindChangeMatcher.to, change.after) &&
      (allowed === undefined ||
        change.fields.every((field) => allowed.includes(field)))
    );
  }
  if ("moved" in m) {
    return change.type === "moved" && matchesRowSpec(m.moved, change.after);
  }
  if ("pageField" in m) {
    return change.type === "pageField" && change.field === m.pageField.field;
  }
  return (
    change.type === "resegmented" &&
    change.after.length > 0 &&
    matchesRowSpec(m.resegmented, change.after[0])
  );
}

export function describeRowChange(change: RowChange): string {
  switch (change.type) {
    case "changed":
      return `changed ${rowKindLabel(change.after)} [${change.fields.join(",")}]`;
    case "reshaped":
      return `reshaped ${rowKindLabel(change.before)} → ${rowKindLabel(change.after)} [${change.fields.join(",")}]`;
    case "resegmented": {
      const sample = change.after[0] ?? change.before[0];
      return `resegmented ${sample ? rowKindLabel(sample) : "?"} ${change.before.length}→${change.after.length}`;
    }
    case "pageField":
      return `changed page.${change.field}`;
    default:
      return `${change.type} ${rowKindLabel(change.type === "moved" ? change.after : change.row)}`;
  }
}

export interface RowDiffReport {
  claims: Map<string, number>;
  claimedEntries: Set<number>;
  examples: Map<string, RowChange>;
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

export function mergeRowDiffReport(
  into: RowDiffReport,
  from: RowDiffReport,
): void {
  for (const [name, count] of from.claims) {
    into.claims.set(name, (into.claims.get(name) ?? 0) + count);
  }
  for (const index of from.claimedEntries) into.claimedEntries.add(index);
  for (const [name, count] of from.containerBoundsBy) {
    into.containerBoundsBy.set(
      name,
      (into.containerBoundsBy.get(name) ?? 0) + count,
    );
  }
  for (const [name, example] of from.examples) {
    if (!into.examples.has(name)) into.examples.set(name, example);
  }
  into.unclassified.push(...from.unclassified);
}

interface SharedThreadState {
  turnsWithChildChanges: Set<string>;
  turnChildClasses: Map<string, Set<string>>;
  movedRows: Map<string, SnapshotRow>;
}

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
  turnStack: string[];
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
  const index = diff.classes.findIndex((candidate) =>
    classMatches(candidate, change),
  );
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

function claimContainerBounds(
  diff: VariantDiff,
  turnId: string | undefined,
  change: RowChange,
): void {
  diff.pendingBounds.push({ turnId, change });
}

function settleContainerBounds(diff: VariantDiff): void {
  for (const { turnId, change } of diff.pendingBounds) {
    claim(diff, CONTAINER_BOUNDS_CLASS, change);
    const causes =
      turnId === undefined
        ? undefined
        : diff.shared.turnChildClasses.get(turnId);
    for (const name of causes ?? ["(unknown)"]) {
      diff.report.containerBoundsBy.set(
        name,
        (diff.report.containerBoundsBy.get(name) ?? 0) + 1,
      );
    }
  }
  diff.pendingBounds = [];
}

function childRowsOf(rows: readonly SnapshotRow[]): SnapshotRow[] {
  const children: SnapshotRow[] = [];
  for (const row of rows) {
    for (const key of CONTAINER_FIELDS) {
      const value = row[key];
      if (Array.isArray(value)) {
        children.push(...z.array(snapshotJsonObjectSchema).parse(value));
      }
    }
  }
  return children;
}

function hasContainer(row: SnapshotRow): boolean {
  for (const key of CONTAINER_FIELDS) {
    if (Array.isArray(row[key])) return true;
  }
  return false;
}

function pool(
  diff: VariantDiff,
  map: Map<string, PooledRow[]>,
  id: string,
  row: SnapshotRow,
): void {
  const entry = { row, turns: [...diff.turnStack] };
  const rows = map.get(id);
  if (rows) rows.push(entry);
  else map.set(id, [entry]);
}

function groupByIdentity(
  rows: readonly SnapshotRow[],
): Map<string, SnapshotRow[]> {
  const groups = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const id = rowIdentity(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

function underTurns<T>(diff: VariantDiff, turns: string[], fn: () => T): T {
  const saved = diff.turnStack;
  diff.turnStack = turns;
  try {
    return fn();
  } finally {
    diff.turnStack = saved;
  }
}

function diffRow(
  diff: VariantDiff,
  b: SnapshotRow,
  a: SnapshotRow,
  id: string,
): number {
  const { thread } = diff;
  const rowKindChanged = rowKindLabel(a) !== rowKindLabel(b);
  const fields: string[] = [];
  let boundsOnly = true;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (CONTAINER_FIELDS.has(key)) continue;
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    const aId = stringValue(a.id);
    const bId = stringValue(b.id);
    if (
      key === "id" &&
      aId !== undefined &&
      bId !== undefined &&
      ownRowId(aId) === ownRowId(bId)
    ) {
      fields.push("id:prefix");
      continue;
    }
    fields.push(key);
    if (!CONTAINER_BOUND_FIELDS.has(key)) boundsOnly = false;
  }
  fields.sort();
  if (rowKindChanged) {
    classify(diff, {
      type: "reshaped",
      thread,
      id,
      before: b,
      after: a,
      fields: fields.filter(
        (field) => field !== "kind" && field !== "workKind",
      ),
    });
  }
  const turnId = b.kind === "turn" ? stringValue(b.turnId) : undefined;
  if (turnId !== undefined) diff.turnStack.push(turnId);
  const nestedChanges = diffRows(diff, childRowsOf([b]), childRowsOf([a]));
  if (turnId !== undefined) diff.turnStack.pop();
  if (nestedChanges > 0 && turnId !== undefined) {
    diff.shared.turnsWithChildChanges.add(turnId);
  }
  let own = rowKindChanged ? 1 : 0;
  if (fields.length > 0 && !rowKindChanged) {
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
      classify(diff, {
        type: "changed",
        thread,
        id,
        before: b,
        after: a,
        fields,
      });
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
      const turnId =
        as[0]?.kind === "turn" ? stringValue(as[0].turnId) : undefined;
      if (turnId !== undefined) diff.turnStack.push(turnId);
      classify(diff, {
        type: "resegmented",
        thread,
        id,
        before: bs,
        after: as,
      });
      changes += 1 + diffRows(diff, childRowsOf(bs), childRowsOf(as));
      if (turnId !== undefined) {
        diff.turnStack.pop();
        diff.shared.turnsWithChildChanges.add(turnId);
      }
      continue;
    }
    for (let index = 0; index < bs.length; index += 1) {
      const beforeRow = bs[index];
      const afterRow = as[index];
      if (beforeRow === undefined || afterRow === undefined) continue;
      changes += diffRow(diff, beforeRow, afterRow, id);
    }
  }
  for (const [id, as] of afterById) {
    if (beforeById.has(id)) continue;
    for (const a of as) pool(diff, diff.added, id, a);
    changes += as.length;
  }
  return changes;
}

function settleVariantDiff(diff: VariantDiff): void {
  const { thread, removed, added, shared } = diff;
  for (const [id, removedRows] of removed) {
    const addedRows = added.get(id);
    if (addedRows) {
      added.delete(id);
      const pairs = Math.min(removedRows.length, addedRows.length);
      for (let index = 0; index < pairs; index += 1) {
        const b = removedRows[index];
        const a = addedRows[index];
        if (b === undefined || a === undefined) continue;
        shared.movedRows.set(id, a.row);
        underTurns(diff, a.turns, () => {
          classify(diff, {
            type: "moved",
            thread,
            id,
            before: b.row,
            after: a.row,
          });
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
          classify(diff, {
            type: "moved",
            thread,
            id,
            before: b.row,
            after: movedTo,
          });
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

export function classifyRowSnapshotDiff(
  thread: string,
  before: RowSnapshotVariants,
  after: RowSnapshotVariants,
  classes: readonly RowDiffClass[],
  report: RowDiffReport,
): number {
  const parsedBefore = rowSnapshotVariantsSchema.parse(before);
  const parsedAfter = rowSnapshotVariantsSchema.parse(after);
  const variants = [
    ...new Set([
      ...Object.keys(parsedBefore.variants ?? {}),
      ...Object.keys(parsedAfter.variants ?? {}),
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
    changes += diffRows(
      diff,
      variantRows(parsedBefore, variant),
      variantRows(parsedAfter, variant),
    );
    settleVariantDiff(diff);
    settleContainerBounds(diff);
    changes += diffPageFields(diff, parsedBefore, parsedAfter, variant);
  }
  return changes;
}

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
    const b = beforePages[index] ?? EMPTY_PAGE;
    const a = afterPages[index] ?? EMPTY_PAGE;
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

export function idleRowDiffClasses(
  classes: readonly RowDiffClass[],
  report: RowDiffReport,
): string[] {
  const sharedNames = new Set(
    classes
      .filter(
        (cls, index) =>
          classes.findIndex((other) => other.name === cls.name) !== index,
      )
      .map((cls) => cls.name),
  );
  return classes.flatMap((cls, index) =>
    report.claimedEntries.has(index)
      ? []
      : [
          sharedNames.has(cls.name)
            ? `${cls.name}#${index} ${JSON.stringify(cls.match)}`
            : cls.name,
        ],
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
    lines.push(
      `  ${count.toString().padStart(6)}  ${name}${cls ? ` — ${cls.reason}` : ""}`,
    );
    const example = report.examples.get(name);
    if (options.examples && example) {
      lines.push(`          e.g. ${JSON.stringify(example).slice(0, 300)}`);
    }
  }
  if (report.containerBoundsBy.size > 0) {
    lines.push(
      `  ${CONTAINER_BOUNDS_CLASS} by child class: ${[
        ...report.containerBoundsBy,
      ]
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
    const byDescription = new Map<string, number>();
    for (const change of report.unclassified) {
      const key = describeRowChange(change);
      byDescription.set(key, (byDescription.get(key) ?? 0) + 1);
    }
    for (const [key, count] of [...byDescription]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 40)) {
      lines.push(`  ${count.toString().padStart(6)}  ${key}`);
    }
  }
  return lines.join("\n");
}
