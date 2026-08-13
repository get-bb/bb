import { useId } from "react";
import type { JsonValue } from "../../../shared/contract.js";

export interface FieldValueView {
  present: boolean;
  value: JsonValue | null;
}

export interface FieldDiffView {
  field: string;
  base: FieldValueView;
  ours: FieldValueView;
  theirs: FieldValueView;
}

function scalarClass(value: JsonValue | null): string {
  return typeof value === "number" ? "text-right tabular-nums" : "text-left";
}

function SemanticValue({ value }: { value: FieldValueView }): React.JSX.Element {
  if (!value.present) {
    return <span className="italic text-muted-foreground">Not present</span>;
  }
  if (value.value === null) {
    return <span className="font-mono text-muted-foreground">null</span>;
  }
  if (typeof value.value === "boolean") {
    return (
      <span className="font-medium text-foreground">
        {value.value ? "True" : "False"}
      </span>
    );
  }
  if (typeof value.value === "number") {
    return <span className="font-mono tabular-nums">{value.value}</span>;
  }
  if (typeof value.value === "string") {
    return <span className="break-words whitespace-pre-wrap">{value.value}</span>;
  }
  if (Array.isArray(value.value)) {
    return (
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          List · {value.value.length} {value.value.length === 1 ? "item" : "items"}
        </p>
        <ol className="mt-1 space-y-1 pl-4">
          {value.value.slice(0, 6).map((entry, index) => (
            <li className="list-decimal break-words" key={index}>
              <SemanticValue value={{ present: true, value: entry }} />
            </li>
          ))}
        </ol>
        {value.value.length > 6 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {value.value.length - 6} more items
          </p>
        ) : null}
      </div>
    );
  }
  const entries = Object.entries(value.value);
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">
        Object · {entries.length} {entries.length === 1 ? "field" : "fields"}
      </p>
      <dl className="mt-1 grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-2 gap-y-1">
        {entries.slice(0, 6).map(([key, entry]) => (
          <div className="contents" key={key}>
            <dt className="truncate font-mono text-xs text-muted-foreground">
              {key}
            </dt>
            <dd className="min-w-0 break-words">
              <SemanticValue value={{ present: true, value: entry }} />
            </dd>
          </div>
        ))}
      </dl>
      {entries.length > 6 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {entries.length - 6} more fields
        </p>
      ) : null}
    </div>
  );
}

function ValueColumn({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: FieldValueView;
  emphasis?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`min-w-0 rounded-md border px-3 py-2 ${
        emphasis ? "border-primary/40 bg-primary/5" : "border-border bg-background"
      }`}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className={`text-sm leading-5 ${scalarClass(value.value)}`}>
        <SemanticValue value={value} />
      </div>
    </div>
  );
}

export function FieldDiff({ diff }: { diff: FieldDiffView }): React.JSX.Element {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h4
        className="break-all font-mono text-xs font-semibold text-foreground"
        id={headingId}
      >
        {diff.field}
      </h4>
      <div className="grid gap-2 md:grid-cols-3">
        <ValueColumn label="Base" value={diff.base} />
        <ValueColumn emphasis label="Ours · proposed" value={diff.ours} />
        <ValueColumn label="Theirs · upstream" value={diff.theirs} />
      </div>
    </section>
  );
}

export function CompactFieldValue({
  label,
  value,
}: {
  label: string;
  value: FieldValueView;
}): React.JSX.Element {
  return <ValueColumn label={label} value={value} />;
}
