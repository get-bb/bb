import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ServerMoveHealth } from "@bb/host-daemon-contract";
import type {
  ServerMoveStatus,
  ServerMoveStep,
  ServerMoveStepStatus,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { appToast } from "@/components/ui/app-toast";
import { invalidateQueriesAfterServerMove } from "@/hooks/cache-owners/server-move-cache-owner";
import { useCancelServerMove } from "@/hooks/mutations/server-move-mutations";
import {
  useServerMoveStatus,
  useServerMoveStatusPolling,
} from "@/hooks/queries/server-move-queries";
import { useServerConnectionState } from "@/hooks/useServerConnectionState";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  SERVER_MOVE_ARRIVAL_PARAM,
  SERVER_MOVE_POLL_INTERVAL_MS,
  nextFollowedServerMove,
  resolveServerMoveOverlay,
  serverMoveDestinationProbeUrl,
  serverMoveOverlayPollIntervalMs,
  serverMoveStepLabel,
  type ServerMoveOverlayContent,
} from "./server-move";
import { fetchServerMoveDestinationHealth } from "./server-move-destination";

type VisibleServerMoveOverlayContent = Exclude<
  ServerMoveOverlayContent,
  { kind: "arrived" }
>;

const STEP_STATUS_PRESENTATION: Record<
  ServerMoveStepStatus,
  { icon: IconName; iconClassName: string; label: string }
> = {
  pending: {
    icon: "Circle",
    iconClassName: "text-subtle-foreground/60",
    label: "Waiting",
  },
  running: {
    icon: "Spinner",
    iconClassName: "animate-spin text-foreground",
    label: "In progress",
  },
  done: {
    icon: "CircleCheck",
    iconClassName: "text-foreground",
    label: "Done",
  },
  failed: {
    icon: "CircleX",
    iconClassName: "text-destructive-text",
    label: "Failed",
  },
  skipped: {
    icon: "Circle",
    iconClassName: "text-subtle-foreground/40",
    label: "Skipped",
  },
};

function assignWindowLocation(url: string): void {
  window.location.assign(url);
}

interface DestinationHealthReading {
  health: ServerMoveHealth | null;
  url: string;
}

function useServerMoveDestinationHealth(
  url: string | null,
  intervalMs: number,
): ServerMoveHealth | null {
  const [reading, setReading] = useState<DestinationHealthReading | null>(null);
  useEffect(() => {
    if (url === null) {
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      const health = await fetchServerMoveDestinationHealth(
        url,
        controller.signal,
      );
      if (controller.signal.aborted) {
        return;
      }
      setReading({ health, url });
      timer = setTimeout(() => {
        void poll();
      }, intervalMs);
    };
    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [intervalMs, url]);
  return reading !== null && reading.url === url ? reading.health : null;
}

export interface ServerMoveOverlayProps {
  navigateTo?: (url: string) => void;
  pollIntervalMs?: number;
}

export function ServerMoveOverlay({
  navigateTo = assignWindowLocation,
  pollIntervalMs = SERVER_MOVE_POLL_INTERVAL_MS,
}: ServerMoveOverlayProps) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const connectionState = useServerConnectionState();
  const status = useServerMoveStatus();
  const cancelMove = useCancelServerMove();
  const [followed, setFollowed] = useState<ServerMoveStatus | null>(null);
  const [dismissedMoveId, setDismissedMoveId] = useState<string | null>(null);

  const nextFollowed = nextFollowedServerMove(
    followed,
    status.data?.move ?? null,
  );
  if (nextFollowed !== followed) {
    setFollowed(nextFollowed);
  }

  const arrivalMoveId = new URLSearchParams(location.search).get(
    SERVER_MOVE_ARRIVAL_PARAM,
  );
  const destinationHealth = useServerMoveDestinationHealth(
    serverMoveDestinationProbeUrl({ move: nextFollowed, error: status.error }),
    pollIntervalMs,
  );

  const content = resolveServerMoveOverlay({
    response: status.data,
    error: status.error,
    followed: nextFollowed,
    dismissedMoveId,
    destination: destinationHealth,
    arrivalMoveId,
    location: {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    },
  });

  useServerMoveStatusPolling(
    serverMoveOverlayPollIntervalMs({
      content,
      realtimeConnected: connectionState === "connected",
      intervalMs: pollIntervalMs,
    }),
  );

  const destination =
    content?.kind === "redirecting" ? content.destination : null;
  const navigatedDestination = useRef<string | null>(null);
  useEffect(() => {
    if (destination === null || navigatedDestination.current === destination) {
      return;
    }
    navigatedDestination.current = destination;
    navigateTo(destination);
  }, [destination, navigateTo]);

  const arrivedMoveId =
    content?.kind === "arrived" ? content.lastMove.moveId : null;
  const arrivedHostName =
    content?.kind === "arrived" ? content.lastMove.toHostName : null;
  const announcedMoveId = useRef<string | null>(null);
  useEffect(() => {
    if (
      arrivedMoveId === null ||
      arrivedHostName === null ||
      announcedMoveId.current === arrivedMoveId
    ) {
      return;
    }
    announcedMoveId.current = arrivedMoveId;
    appToast.success(`Server moved to ${arrivedHostName}`);
    invalidateQueriesAfterServerMove({ queryClient });
  }, [arrivedHostName, arrivedMoveId, queryClient]);

  const statusLoaded = status.data !== undefined;
  useEffect(() => {
    if (arrivalMoveId === null || !statusLoaded) {
      return;
    }
    const params = new URLSearchParams(location.search);
    params.delete(SERVER_MOVE_ARRIVAL_PARAM);
    const search = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: search.length === 0 ? "" : `?${search}`,
        hash: location.hash,
      },
      { replace: true },
    );
  }, [
    arrivalMoveId,
    location.hash,
    location.pathname,
    location.search,
    navigate,
    statusLoaded,
  ]);

  if (content === null || content.kind === "arrived") {
    return null;
  }

  return (
    <ServerMoveOverlayView
      content={content}
      cancelPending={cancelMove.isPending}
      cancelError={
        cancelMove.isError
          ? getMutationErrorMessage({
              error: cancelMove.error,
              fallbackMessage: "Couldn't cancel the move.",
            })
          : null
      }
      onCancel={() => cancelMove.mutate()}
      onClose={() => {
        cancelMove.reset();
        setDismissedMoveId(content.move.moveId);
      }}
    />
  );
}

export interface ServerMoveOverlayViewProps {
  content: VisibleServerMoveOverlayContent;
  cancelPending: boolean;
  cancelError: string | null;
  onCancel: () => void;
  onClose: () => void;
  presentation?: "overlay" | "inline";
}

export function ServerMoveOverlayView({
  content,
  cancelPending,
  cancelError,
  onCancel,
  onClose,
  presentation = "overlay",
}: ServerMoveOverlayViewProps) {
  const titleId = useId();
  const descriptionId = useId();
  const { move } = content;
  const failed = content.kind === "ended" && move.state === "failed";
  const note = overlayNote(content);

  const card = (
    <div className="grid w-full max-w-md grid-cols-[minmax(0,1fr)] gap-4 rounded-lg border border-border bg-background p-6 shadow-lg">
      <div className="space-y-1.5">
        <h2
          id={titleId}
          className="text-base leading-tight font-semibold tracking-tight text-foreground"
        >
          {overlayTitle(content)}
        </h2>
        <p
          id={descriptionId}
          className={cn(
            "text-sm break-words",
            failed ? "text-destructive-text" : "text-muted-foreground",
          )}
        >
          {overlayDescription(content)}
        </p>
        {note === null ? null : (
          <p className="text-sm text-muted-foreground">{note}</p>
        )}
      </div>
      {move.steps.length === 0 ? null : (
        <ServerMoveStepList
          steps={move.steps}
          targetHostName={move.targetHostName}
        />
      )}
      {cancelError === null ? null : (
        <p role="alert" className="text-sm text-destructive-text">
          {cancelError}
        </p>
      )}
      <ServerMoveOverlayActions
        content={content}
        cancelPending={cancelPending}
        onCancel={onCancel}
        onClose={onClose}
      />
    </div>
  );

  if (presentation === "inline") {
    return (
      <div role="group" aria-labelledby={titleId} className="w-full max-w-md">
        {card}
      </div>
    );
  }

  return (
    <ServerMoveOverlayLayer titleId={titleId} descriptionId={descriptionId}>
      {card}
    </ServerMoveOverlayLayer>
  );
}

function ServerMoveOverlayLayer({
  titleId,
  descriptionId,
  children,
}: {
  titleId: string;
  descriptionId: string;
  children: ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    layerRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={layerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      data-server-move-overlay
      className="fixed inset-0 z-60 flex items-center justify-center overflow-y-auto bg-surface-scrim p-4 outline-none"
    >
      {children}
    </div>
  );
}

function ServerMoveOverlayActions({
  content,
  cancelPending,
  onCancel,
  onClose,
}: {
  content: VisibleServerMoveOverlayContent;
  cancelPending: boolean;
  onCancel: () => void;
  onClose: () => void;
}) {
  if (content.kind === "progress") {
    if (!content.move.cancellable) return null;
    return (
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={cancelPending}
          onClick={onCancel}
        >
          {cancelPending ? "Cancelling…" : "Cancel move"}
        </Button>
      </div>
    );
  }
  if (content.kind === "recovery") {
    return (
      <ServerMoveRecoveryActions
        targetHostName={content.move.targetHostName}
        cancelPending={cancelPending}
        onAbandon={onCancel}
      />
    );
  }
  if (content.kind === "redirecting") {
    return (
      <div className="flex justify-end">
        <Button asChild variant="outline">
          <a href={content.destination}>Open the new address</a>
        </Button>
      </div>
    );
  }
  if (content.kind === "reconnecting" || content.kind === "waiting") {
    return null;
  }
  return (
    <div className="flex justify-end">
      <Button type="button" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

function ServerMoveRecoveryActions({
  targetHostName,
  cancelPending,
  onAbandon,
}: {
  targetHostName: string;
  cancelPending: boolean;
  onAbandon: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirming(true)}
        >
          Abandon move…
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-destructive-text">
        {`Abandon only if ${targetHostName} isn't running the server. If it already took over, two servers will run with the same data.`}
      </p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={cancelPending}
          onClick={() => setConfirming(false)}
        >
          Keep waiting
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={cancelPending}
          onClick={onAbandon}
        >
          {cancelPending ? "Abandoning…" : "Abandon move"}
        </Button>
      </div>
    </div>
  );
}

function isAbandonedSwitch(move: ServerMoveStatus): boolean {
  return move.state === "cancelled" && move.error?.step === "switch";
}

function overlayTitle(content: VisibleServerMoveOverlayContent): string {
  const name = content.move.targetHostName;
  switch (content.kind) {
    case "progress":
      return `Moving server to ${name}`;
    case "recovery":
      return `Couldn't confirm the switch to ${name}`;
    case "waiting":
      return `Starting the server on ${name}…`;
    case "redirecting":
      return `Server moved to ${name}`;
    case "reconnecting":
      return `Reconnecting to ${name}…`;
    case "ended":
      if (isAbandonedSwitch(content.move)) {
        return "Server move abandoned";
      }
      return content.move.state === "cancelled"
        ? "Server move cancelled"
        : `Couldn't move the server to ${name}`;
    case "abandoned":
      return "Server move stopped";
  }
}

function overlayDescription(content: VisibleServerMoveOverlayContent): string {
  const name = content.move.targetHostName;
  switch (content.kind) {
    case "progress":
      return content.move.state === "switching"
        ? `Every machine and app is switching over to ${name}. The move can't be cancelled now.`
        : `bb is copying the server to ${name}. Every app shows this screen until the move finishes.`;
    case "recovery":
      return `${name} didn't confirm that it took over, so this server stays up but read-only. bb keeps checking and finishes the move as soon as ${name} answers.`;
    case "waiting":
      return content.destinationState === "activating"
        ? `${name} is switching over to the new server. This page opens it as soon as it's ready.`
        : `The server on ${name} is starting. This page opens ${content.move.serverUrl} as soon as it answers.`;
    case "redirecting":
      return `Opening the server at ${content.move.serverUrl}…`;
    case "reconnecting":
      return `The server on ${name} is starting. This page reconnects as soon as it answers.`;
    case "ended":
      if (isAbandonedSwitch(content.move)) {
        return `The server keeps running here. If ${name} took over anyway, stop the server there.`;
      }
      return content.move.state === "cancelled"
        ? "The server keeps running where it was."
        : (content.move.error?.message ??
            "The move stopped before it finished.");
    case "abandoned":
      return `The server restarted before the move to ${name} finished, so nothing switched over.`;
  }
}

function overlayNote(content: VisibleServerMoveOverlayContent): string | null {
  if (content.kind === "recovery") {
    const name = content.move.targetHostName;
    return `If ${name} isn't running the server, abandon the move to keep the server here. If this server stops, run bb server unlock on this computer.`;
  }
  if (
    content.kind === "ended" &&
    content.move.state === "failed" &&
    content.move.error?.step !== "switch"
  ) {
    return "The server keeps running where it was.";
  }
  return null;
}

export function ServerMoveStepList({
  steps,
  targetHostName,
}: {
  steps: readonly ServerMoveStep[];
  targetHostName: string;
}) {
  return (
    <ol className="space-y-2" aria-label="Move steps">
      {steps.map((step) => {
        const presentation = STEP_STATUS_PRESENTATION[step.status];
        return (
          <li
            key={step.id}
            data-step={step.id}
            data-status={step.status}
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
              <p
                className={cn(
                  "text-sm",
                  step.status === "failed"
                    ? "text-destructive-text"
                    : step.status === "pending" || step.status === "skipped"
                      ? "text-muted-foreground"
                      : "text-foreground",
                )}
              >
                <span>{serverMoveStepLabel(step.id, targetHostName)}</span>
                <span className="sr-only">{`, ${presentation.label}`}</span>
              </p>
              {step.status === "skipped" ? (
                <p className="text-xs text-subtle-foreground">Skipped</p>
              ) : step.message === null ? null : (
                <p className="text-xs break-words text-subtle-foreground">
                  {step.message}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
