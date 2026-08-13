import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { type CanvasEntityKind, type DeletionImpact } from "./schema.js";

export interface DeleteImpactDialogProps {
  entityKind: CanvasEntityKind;
  impact: DeletionImpact | null;
  loading: boolean;
  error: string | null;
  blockedReason?: string;
  onCancel(): void;
  onConfirm(mode: "cascade" | "detach"): void;
}

export function DeleteImpactDialog({
  entityKind,
  impact,
  loading,
  error,
  blockedReason,
  onCancel,
  onConfirm,
}: DeleteImpactDialogProps): React.JSX.Element {
  const [mode, setMode] = useState<"cascade" | "detach">("cascade");
  const [confirmation, setConfirmation] = useState("");
  const selectedMode =
    impact?.allowedActions.includes(mode) === true
      ? mode
      : (impact?.allowedActions[0] ?? "cascade");
  const confirmed =
    impact?.restorable !== false || confirmation === impact.slug;

  return (
    <div
      aria-label="Delete impact"
      aria-modal="true"
      className="fixed inset-0 z-[80] grid place-items-center bg-background/70 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <section className="w-full max-w-lg rounded-xl border border-border bg-card text-card-foreground shadow-xl">
        <header className="flex items-start gap-3 border-b border-border p-5">
          <span className="rounded-md bg-destructive/10 p-2 text-destructive">
            <Icon aria-hidden="true" name="Trash2" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Review delete impact</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This changes tracked YAML only. Nothing is deleted from Assurance
              Studio.
            </p>
          </div>
        </header>

        <div className="space-y-4 p-5">
          {loading ? (
            <p className="text-sm text-muted-foreground" role="status">
              Computing references and allowed actions…
            </p>
          ) : null}
          {error ? (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {blockedReason ? (
            <p
              className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
              role="status"
            >
              {blockedReason}
            </p>
          ) : null}
          {impact ? (
            <>
              <div>
                <p className="text-sm font-medium">
                  {entityKind} / {impact.slug}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {impact.referrers.length === 0
                    ? "No authored references are affected."
                    : `${impact.referrers.length} authored reference(s) are affected.`}
                </p>
              </div>
              {impact.referrers.length > 0 ? (
                <ul className="max-h-48 space-y-2 overflow-auto rounded-md border border-border p-3">
                  {impact.referrers.map((referrer) => (
                    <li
                      className="text-sm"
                      key={`${referrer.kind}:${referrer.slug}:${referrer.effect}`}
                    >
                      <span className="font-medium">
                        {referrer.kind} / {referrer.slug}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {referrer.effect}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Delete behavior</legend>
                {impact.allowedActions.map((action) => (
                  <label
                    className="flex items-start gap-2 rounded-md border border-border p-3 text-sm"
                    key={action}
                  >
                    <input
                      checked={selectedMode === action}
                      className="mt-0.5"
                      name="delete-mode"
                      onChange={() => setMode(action)}
                      type="radio"
                    />
                    <span>
                      <span className="font-medium capitalize">{action}</span>
                      <span className="block text-xs text-muted-foreground">
                        {action === "cascade"
                          ? "The Sync review must include dependent removals before push."
                          : "The Sync review must remove optional references before push."}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {!impact.restorable ? (
                <label className="block space-y-1.5 text-sm font-medium">
                  Type {impact.slug} to confirm this non-restorable entity
                  <input
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    onChange={(event) => setConfirmation(event.target.value)}
                    value={confirmation}
                  />
                  <span className="block text-xs font-normal text-muted-foreground">
                    Git remains the recovery path after a future human-approved
                    push.
                  </span>
                </label>
              ) : null}
            </>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-border p-4">
          <Button onClick={onCancel} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={
              !impact ||
              loading ||
              Boolean(error) ||
              Boolean(blockedReason) ||
              !confirmed
            }
            onClick={() => onConfirm(selectedMode)}
            type="button"
            variant="destructive"
          >
            Delete local YAML
          </Button>
        </footer>
      </section>
    </div>
  );
}
