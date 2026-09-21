import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { ServerMoveHealth } from "@bb/host-daemon-contract";
import type { ServerMoveStatus } from "@bb/server-contract";
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
} from "./server-move";
import { fetchServerMoveDestinationHealth } from "./server-move-destination";

const ServerMoveOverlayView = lazy(() =>
  import("./ServerMoveOverlayView").then((module) => ({
    default: module.ServerMoveOverlayView,
  })),
);

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
    <Suspense fallback={null}>
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
    </Suspense>
  );
}
