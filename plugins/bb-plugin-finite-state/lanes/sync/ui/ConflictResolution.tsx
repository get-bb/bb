import { useId, useState } from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { usePortalScopeProps } from "@bb/shared-ui/lib/portal-scope";
import { Textarea } from "@bb/shared-ui/textarea";
import type { JsonValue } from "../../../shared/contract.js";
import { CompactFieldValue, type FieldValueView } from "./FieldDiff.js";

export type ConflictChoice =
  | { choice: "take-ours" }
  | { choice: "take-theirs" }
  | { choice: "edited"; value: JsonValue };

export interface ConflictView {
  field: string;
  base: FieldValueView;
  ours: FieldValueView;
  theirs: FieldValueView;
  attribution: {
    actor: string | null;
    at: string | null;
    source: string | null;
  } | null;
  suggestion: "take-ours" | "take-theirs" | null;
  resolution: ConflictChoice | null;
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
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

function parseEditedValue(source: string): JsonValue {
  const value: unknown = JSON.parse(source);
  if (!isJsonValue(value)) {
    throw new Error("Enter a finite JSON value.");
  }
  return value;
}

function initialEditValue(conflict: ConflictView): string {
  const value = conflict.ours.present ? conflict.ours.value : null;
  return JSON.stringify(value, null, 2) ?? "null";
}

function resolutionLabel(resolution: ConflictChoice): string {
  if (resolution.choice === "take-ours") return "Resolved: ours";
  if (resolution.choice === "take-theirs") return "Resolved: theirs";
  return "Resolved: edited value";
}

export interface ConflictResolutionProps {
  conflict: ConflictView;
  authorizationAvailable: boolean;
  submitting: boolean;
  error: string | null;
  onResolve(resolution: ConflictChoice): Promise<void>;
}

export function ConflictResolution({
  conflict,
  authorizationAvailable,
  submitting,
  error,
  onResolve,
}: ConflictResolutionProps): React.JSX.Element {
  const portalScopeProps = usePortalScopeProps();
  const headingId = useId();
  const editInputId = useId();
  const [editOpen, setEditOpen] = useState(false);
  const [editedValue, setEditedValue] = useState(() =>
    initialEditValue(conflict),
  );
  const [editError, setEditError] = useState<string | null>(null);
  const disabled = !authorizationAvailable || submitting;
  const attribution = conflict.attribution;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-destructive/40 bg-card p-3"
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h4
            className="break-all font-mono text-xs font-semibold text-foreground"
            id={headingId}
          >
            {conflict.field}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {attribution ? (
              <>
                Upstream attribution: {attribution.actor ?? "Unknown actor"}
                {attribution.at ? ` · ${attribution.at}` : ""}
                {attribution.source ? ` · ${attribution.source}` : ""}
              </>
            ) : (
              "Upstream attribution unavailable"
            )}
          </p>
        </div>
        {conflict.suggestion ? (
          <Badge variant="outline">
            Suggestion only: {conflict.suggestion === "take-ours" ? "Take ours" : "Take theirs"}
          </Badge>
        ) : (
          <Badge variant="outline">No suggested choice</Badge>
        )}
        {conflict.resolution ? (
          <Badge variant="secondary">
            {resolutionLabel(conflict.resolution)}
          </Badge>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <CompactFieldValue label="Base" value={conflict.base} />
        <CompactFieldValue label="Ours · proposed" value={conflict.ours} />
        <CompactFieldValue label="Theirs · upstream" value={conflict.theirs} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          disabled={disabled}
          onClick={() => void onResolve({ choice: "take-ours" })}
          size="sm"
          variant="outline"
        >
          Take ours
        </Button>
        <Button
          disabled={disabled}
          onClick={() => void onResolve({ choice: "take-theirs" })}
          size="sm"
          variant="outline"
        >
          Take theirs
        </Button>
        <Dialog onOpenChange={setEditOpen} open={editOpen}>
          <DialogTrigger asChild>
            <Button disabled={disabled} size="sm" variant="outline">
              <Icon aria-hidden="true" name="Edit" />
              Edit value
            </Button>
          </DialogTrigger>
          <DialogContent {...portalScopeProps}>
            <DialogHeader>
              <DialogTitle>Edit {conflict.field}</DialogTitle>
              <DialogDescription>
                Enter one JSON value. This is an explicit human choice, not an
                application of the suggested resolution.
              </DialogDescription>
            </DialogHeader>
            <label className="text-sm font-medium" htmlFor={editInputId}>
              JSON value
            </label>
            <Textarea
              aria-invalid={editError ? true : undefined}
              className="min-h-40 font-mono text-xs"
              id={editInputId}
              onChange={(event) => {
                setEditedValue(event.target.value);
                setEditError(null);
              }}
              value={editedValue}
            />
            {editError ? (
              <p className="text-sm text-destructive" role="alert">
                {editError}
              </p>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button aria-label="Cancel edit" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                disabled={submitting}
                onClick={() => {
                  try {
                    const value = parseEditedValue(editedValue);
                    setEditError(null);
                    void onResolve({ choice: "edited", value }).then(() =>
                      setEditOpen(false),
                    );
                  } catch (caught) {
                    setEditError(
                      caught instanceof Error
                        ? caught.message
                        : "Enter a valid JSON value.",
                    );
                  }
                }}
              >
                Apply edited value
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!authorizationAvailable ? (
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" name="Lock" />
          Web conflict approval is unavailable in v1 because no authenticated
          human capability can be issued. Reconcile the authored file in the
          worktree, then regenerate the plan with `bb finite-state plan`.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
