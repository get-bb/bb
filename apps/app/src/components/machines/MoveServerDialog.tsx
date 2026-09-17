import { useEffect, useId, useState } from "react";
import { formatServerDataSize, type Host } from "@bb/domain";
import type {
  ServerMoveCheckItem,
  ServerMoveCheckResponse,
  ServerMoveCheckSeverity,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useCheckServerMove,
  useStartServerMove,
} from "@/hooks/mutations/server-move-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  SERVER_MOVE_SEVERITY_ORDER,
  groupServerMoveCheckItems,
  serverMoveBlockedItems,
  serverMoveStartAllowed,
} from "./server-move";

type StartServerMoveMutation = ReturnType<typeof useStartServerMove>;

const SEVERITY_PRESENTATION: Record<
  ServerMoveCheckSeverity,
  { heading: string; icon: IconName; iconClassName: string }
> = {
  blocker: {
    heading: "Fix before moving",
    icon: "AlertCircle",
    iconClassName: "text-destructive-text",
  },
  warning: {
    heading: "Before you move",
    icon: "AlertTriangle",
    iconClassName: "text-warning-text",
  },
  info: {
    heading: "Good to know",
    icon: "Info",
    iconClassName: "text-muted-foreground",
  },
};

export function MoveServerDialog({
  target,
  onOpenChange,
}: {
  target: Host | null;
  onOpenChange: (open: boolean) => void;
}) {
  const startMove = useStartServerMove();
  const close = () => {
    if (startMove.isPending) return;
    startMove.reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      modal={false}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        hideCloseButton={startMove.isPending}
      >
        {target === null ? null : (
          <MoveServerDialogContent
            key={target.id}
            target={target}
            startMove={startMove}
            onCancel={close}
            onStarted={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MoveServerDialogContent({
  target,
  startMove,
  onCancel,
  onStarted,
}: {
  target: Host;
  startMove: StartServerMoveMutation;
  onCancel: () => void;
  onStarted: () => void;
}) {
  const checkMove = useCheckServerMove();
  const [result, setResult] = useState<ServerMoveCheckResponse | null>(null);
  const [checkedServerUrl, setCheckedServerUrl] = useState<string | null>(null);
  const [addressDraft, setAddressDraft] = useState("");
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);

  const runCheck = checkMove.mutate;
  const targetHostId = target.id;
  useEffect(() => {
    runCheck(
      { targetHostId, serverUrl: null },
      {
        onSuccess: (response) => {
          setResult(response);
          setCheckedServerUrl(null);
          if (response.requiresServerUrl && response.serverUrl !== null) {
            setAddressDraft(response.serverUrl);
          }
        },
      },
    );
  }, [runCheck, targetHostId]);

  const showAddress =
    result?.requiresServerUrl === true || checkedServerUrl !== null;

  const check = () => {
    const trimmed = addressDraft.trim();
    const serverUrl = showAddress && trimmed.length > 0 ? trimmed : null;
    startMove.reset();
    checkMove.mutate(
      { targetHostId, serverUrl },
      {
        onSuccess: (response) => {
          if (
            response.existingTargetServerData?.path !==
            result?.existingTargetServerData?.path
          ) {
            setArchiveConfirmed(false);
          }
          setResult(response);
          setCheckedServerUrl(serverUrl);
        },
      },
    );
  };

  const startAllowed = serverMoveStartAllowed({
    result,
    checking: checkMove.isPending,
    starting: startMove.isPending,
    showAddress,
    addressDraft,
    checkedServerUrl,
    archiveConfirmed,
  });

  const start = () => {
    if (result === null || !startAllowed) return;
    startMove.mutate(
      {
        targetHostId,
        serverUrl: checkedServerUrl,
        stopRunningWork: true,
        archiveExistingTargetServerData:
          result.existingTargetServerData !== null && archiveConfirmed,
      },
      {
        onSuccess: onStarted,
        onError: (error) => {
          const items = serverMoveBlockedItems(error);
          if (items !== null) {
            setResult({ ...result, items, canMove: false });
          }
        },
      },
    );
  };

  return (
    <MoveServerDialogView
      targetName={target.name}
      result={result}
      checking={checkMove.isPending}
      checkError={
        checkMove.isError
          ? getMutationErrorMessage({
              error: checkMove.error,
              fallbackMessage: `Couldn't check ${target.name}.`,
            })
          : null
      }
      showAddress={showAddress}
      addressDraft={addressDraft}
      archiveConfirmed={archiveConfirmed}
      startAllowed={startAllowed}
      starting={startMove.isPending}
      startError={
        startMove.isError
          ? getMutationErrorMessage({
              error: startMove.error,
              fallbackMessage: "Couldn't start the move.",
            })
          : null
      }
      onAddressDraftChange={setAddressDraft}
      onCheck={check}
      onArchiveConfirmedChange={setArchiveConfirmed}
      onStart={start}
      onCancel={onCancel}
    />
  );
}

export interface MoveServerDialogViewProps {
  targetName: string;
  result: ServerMoveCheckResponse | null;
  checking: boolean;
  checkError: string | null;
  showAddress: boolean;
  addressDraft: string;
  archiveConfirmed: boolean;
  startAllowed: boolean;
  starting: boolean;
  startError: string | null;
  onAddressDraftChange: (value: string) => void;
  onCheck: () => void;
  onArchiveConfirmedChange: (checked: boolean) => void;
  onStart: () => void;
  onCancel: () => void;
}

export function MoveServerDialogView({
  targetName,
  result,
  checking,
  checkError,
  showAddress,
  addressDraft,
  archiveConfirmed,
  startAllowed,
  starting,
  startError,
  onAddressDraftChange,
  onCheck,
  onArchiveConfirmedChange,
  onStart,
  onCancel,
}: MoveServerDialogViewProps) {
  const hasBlockers =
    result?.items.some((item) => item.severity === "blocker") ?? false;
  const showCheckAgain =
    !checking && (checkError !== null || hasBlockers) && !showAddress;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move the server to {targetName}</DialogTitle>
        <DialogDescription>
          Your threads, settings and plugin data move to {targetName}. Every
          machine and app switches over when it's done, and the current server
          machine keeps running as a regular machine.
        </DialogDescription>
      </DialogHeader>
      {result === null && checkError === null ? (
        <div className="flex items-center gap-2.5 rounded-md bg-muted/40 px-3 py-2.5">
          <Icon
            name="Spinner"
            className="size-4 shrink-0 animate-spin text-muted-foreground"
          />
          <span role="status" className="text-sm text-muted-foreground">
            Checking {targetName}…
          </span>
        </div>
      ) : null}
      {showAddress ? (
        <ServerAddressField
          targetName={targetName}
          value={addressDraft}
          checking={checking}
          disabled={starting}
          onChange={onAddressDraftChange}
          onCheck={onCheck}
        />
      ) : null}
      {checkError === null ? null : (
        <p role="alert" className="text-sm text-destructive-text">
          {checkError}
        </p>
      )}
      {result === null ? null : (
        <ServerMoveCheckItems items={result.items} dimmed={checking} />
      )}
      {result?.existingTargetServerData ? (
        <ArchiveExistingDataConfirmation
          path={result.existingTargetServerData.path}
          sizeBytes={result.existingTargetServerData.sizeBytes}
          checked={archiveConfirmed}
          disabled={starting}
          onCheckedChange={onArchiveConfirmedChange}
        />
      ) : null}
      {startError === null ? null : (
        <p role="alert" className="text-sm text-destructive-text">
          {startError}
        </p>
      )}
      <p className="text-xs text-subtle-foreground">
        Moving stops every running turn and pauses scheduled automations.
      </p>
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={starting}
          onClick={onCancel}
        >
          Cancel
        </Button>
        {showCheckAgain ? (
          <Button
            type="button"
            variant="outline"
            disabled={starting}
            onClick={onCheck}
          >
            Check again
          </Button>
        ) : null}
        <Button type="button" disabled={!startAllowed} onClick={onStart}>
          {starting ? "Starting…" : "Stop all and move"}
        </Button>
      </DialogFooter>
    </>
  );
}

function ServerAddressField({
  targetName,
  value,
  checking,
  disabled,
  onChange,
  onCheck,
}: {
  targetName: string;
  value: string;
  checking: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onCheck: () => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const canCheck = !checking && !disabled && value.trim().length > 0;
  return (
    <div className="space-y-2">
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-foreground"
      >
        New server address
      </label>
      <p id={hintId} className="text-xs text-subtle-foreground">
        Machines and apps use this address to reach the server on {targetName}{" "}
        after the move.
      </p>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={inputId}
          aria-describedby={hintId}
          className="min-w-0 flex-1"
          value={value}
          placeholder="https://bb.example.com"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (canCheck) onCheck();
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={!canCheck}
          onClick={onCheck}
        >
          {checking ? "Checking…" : "Check address"}
        </Button>
      </div>
    </div>
  );
}

export function ServerMoveCheckItems({
  items,
  dimmed,
}: {
  items: readonly ServerMoveCheckItem[];
  dimmed: boolean;
}) {
  const groups = groupServerMoveCheckItems(items);
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing needs attention before the move.
      </p>
    );
  }
  return (
    <div className={cn("space-y-3 transition-opacity", dimmed && "opacity-60")}>
      {SERVER_MOVE_SEVERITY_ORDER.map((severity) => {
        const groupItems = groups[severity];
        if (groupItems.length === 0) return null;
        const presentation = SEVERITY_PRESENTATION[severity];
        return (
          <section
            key={severity}
            aria-label={presentation.heading}
            className="space-y-1.5"
          >
            <h3 className="text-xs font-medium text-muted-foreground">
              {presentation.heading}
            </h3>
            <ul className="space-y-2">
              {groupItems.map((item) => (
                <li
                  key={item.id}
                  data-severity={severity}
                  className="flex items-start gap-2.5"
                >
                  <Icon
                    name={presentation.icon}
                    aria-hidden
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      presentation.iconClassName,
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm break-words text-foreground">
                      {item.title}
                    </p>
                    {item.detail === null ? null : (
                      <p className="text-xs break-words text-subtle-foreground">
                        {item.detail}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ArchiveExistingDataConfirmation({
  path,
  sizeBytes,
  checked,
  disabled,
  onCheckedChange,
}: {
  path: string;
  sizeBytes: number;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2.5 rounded-md border border-border px-3 py-2.5">
      <Checkbox
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm break-words text-foreground">
          Archive the existing bb data at {path}
        </span>
        <span className="block text-xs text-subtle-foreground">
          {formatServerDataSize(sizeBytes)}. bb renames it to a backup folder
          next to it and never merges it.
        </span>
      </span>
    </label>
  );
}
