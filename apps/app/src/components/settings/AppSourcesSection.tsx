import { useId, useState, type FormEvent } from "react";
import { timeAgo } from "@bb/core-ui";
import type { AppSourceAppState, AppSourceStatus } from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Icon } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { Pill } from "@/components/ui/pill.js";
import {
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section.js";
import { useAppSources } from "@/hooks/queries/thread-queries";
import {
  useAddAppSource,
  useRemoveAppSource,
  useSyncAppSource,
} from "@/hooks/mutations/app-source-mutations";

interface AppSourceAppStatePillProps {
  state: AppSourceAppState;
}

function AppSourceAppStatePill({ state }: AppSourceAppStatePillProps) {
  const variant =
    state.status === "installed"
      ? "secondary"
      : state.status === "modified"
        ? "emphasis"
        : "destructive";
  return (
    <span title={state.error ?? undefined}>
      <Pill variant={variant}>
        {state.applicationId} · {state.status}
      </Pill>
    </span>
  );
}

interface AddAppSourceDialogProps {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (args: { origin: string; name?: string; ref?: string }) => void;
}

function AddAppSourceDialog({
  open,
  pending,
  onOpenChange,
  onAdd,
}: AddAppSourceDialogProps) {
  const originId = useId();
  const nameId = useId();
  const refId = useId();
  const [origin, setOrigin] = useState("");
  const [name, setName] = useState("");
  const [ref, setRef] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const trimmedOrigin = origin.trim();
    if (!trimmedOrigin) {
      setValidationMessage("Enter a git URL or local path.");
      return;
    }
    const trimmedName = name.trim();
    const trimmedRef = ref.trim();
    onAdd({
      origin: trimmedOrigin,
      ...(trimmedName ? { name: trimmedName } : {}),
      ...(trimmedRef ? { ref: trimmedRef } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add app source</DialogTitle>
            <DialogDescription>
              Install every app from a git repo and keep them updated with
              manual syncs. Apps from a source serve browser code and inject
              agent skills — only add repos you trust.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor={originId} className="text-xs font-medium">
                Git URL or local path
              </label>
              <Input
                id={originId}
                value={origin}
                placeholder="https://github.com/you/your-bb-apps.git"
                disabled={pending}
                onChange={(event) => {
                  setOrigin(event.target.value);
                  setValidationMessage(null);
                }}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={nameId} className="text-xs font-medium">
                Name{" "}
                <span className="font-normal text-muted-foreground">
                  (optional, derived from the repo name)
                </span>
              </label>
              <Input
                id={nameId}
                value={name}
                placeholder="team-apps"
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={refId} className="text-xs font-medium">
                Ref{" "}
                <span className="font-normal text-muted-foreground">
                  (optional branch, tag, or commit; default branch when empty)
                </span>
              </label>
              <Input
                id={refId}
                value={ref}
                placeholder="main"
                disabled={pending}
                onChange={(event) => setRef(event.target.value)}
              />
            </div>
            {validationMessage ? (
              <p className="text-xs text-destructive">{validationMessage}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add source"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ConfirmAppSourceActionDialogProps {
  target: AppSourceStatus | null;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (source: AppSourceStatus) => void;
}

function ConfirmAppSourceActionDialog({
  target,
  title,
  description,
  confirmLabel,
  pending,
  onOpenChange,
  onConfirm,
}: ConfirmAppSourceActionDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => onConfirm(target)}
              >
                {confirmLabel}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function formatLastSynced(source: AppSourceStatus): string {
  if (source.syncing) {
    return "Syncing…";
  }
  if (source.lastSyncedAt === null) {
    return "Never synced";
  }
  return `Synced ${timeAgo(Date.parse(source.lastSyncedAt))}`;
}

export function AppSourcesSection() {
  const { data: sources = [], isLoading } = useAppSources();
  const addAppSource = useAddAppSource();
  const syncAppSource = useSyncAppSource();
  const removeAppSource = useRemoveAppSource();
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<AppSourceStatus | null>(
    null,
  );
  const [forceSyncTarget, setForceSyncTarget] =
    useState<AppSourceStatus | null>(null);

  return (
    <SettingsSection
      title="App sources"
      description="Git repos of apps that install together and update on sync."
      action={
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
          Add source
        </Button>
      }
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <SettingsRowList>
          {sources.length === 0 ? (
            <SettingsRow>
              <span className="text-sm text-muted-foreground">
                No app sources. Add a git repo of apps to install them.
              </span>
            </SettingsRow>
          ) : (
            sources.map((source) => (
              <SettingsRow key={source.name}>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {source.name}
                    </span>
                    {source.ref !== null ? (
                      <Pill variant="outline">{source.ref}</Pill>
                    ) : null}
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatLastSynced(source)}
                      {source.lastCommitSha !== null
                        ? ` · ${source.lastCommitSha.slice(0, 8)}`
                        : null}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {source.origin}
                  </p>
                  {source.lastError !== null ? (
                    <p className="text-xs text-destructive">
                      {source.lastError}
                    </p>
                  ) : null}
                  {source.apps.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {source.apps.map((app) => (
                        <AppSourceAppStatePill
                          key={app.applicationId}
                          state={app}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      aria-label={`App source actions for ${source.name}`}
                    >
                      <Icon name="MoreHorizontal" className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={syncAppSource.isPending}
                      onSelect={() =>
                        syncAppSource.mutate({
                          name: source.name,
                          force: false,
                        })
                      }
                    >
                      Sync now
                    </DropdownMenuItem>
                    {source.apps.some((app) => app.status === "modified") ? (
                      <DropdownMenuItem
                        disabled={syncAppSource.isPending}
                        onSelect={() => setForceSyncTarget(source)}
                      >
                        Force sync…
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setRemoveTarget(source)}
                    >
                      Remove…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SettingsRow>
            ))
          )}
        </SettingsRowList>
      )}
      <AddAppSourceDialog
        open={addOpen}
        pending={addAppSource.isPending}
        onOpenChange={setAddOpen}
        onAdd={(args) =>
          addAppSource.mutate(args, { onSuccess: () => setAddOpen(false) })
        }
      />
      <ConfirmAppSourceActionDialog
        target={removeTarget}
        title="Remove app source"
        description={
          removeTarget
            ? `Remove "${removeTarget.name}" and the apps it installed? App data is kept and reattaches if the apps are reinstalled.`
            : ""
        }
        confirmLabel="Remove source"
        pending={removeAppSource.isPending}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        onConfirm={(source) =>
          removeAppSource.mutate(source.name, {
            onSuccess: () => setRemoveTarget(null),
          })
        }
      />
      <ConfirmAppSourceActionDialog
        target={forceSyncTarget}
        title="Force sync"
        description={
          forceSyncTarget
            ? `Force syncing "${forceSyncTarget.name}" discards local edits to its modified apps and reinstalls them from the source.`
            : ""
        }
        confirmLabel="Discard local edits and sync"
        pending={syncAppSource.isPending}
        onOpenChange={(open) => {
          if (!open) setForceSyncTarget(null);
        }}
        onConfirm={(source) =>
          syncAppSource.mutate(
            { name: source.name, force: true },
            { onSuccess: () => setForceSyncTarget(null) },
          )
        }
      />
    </SettingsSection>
  );
}
