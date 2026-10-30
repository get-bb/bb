import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  getServerChoices,
  type ServerChoice,
  type ServerChoicesSnapshot,
} from "@/lib/server-choices";

export interface ServerChoicesState {
  status: "loading" | "ready";
  servers: readonly ServerChoice[];
  switchTo(id: string): void;
}

const noServers: ServerChoicesSnapshot = { status: "ready", servers: [] };

function subscribeToNothing(): () => void {
  return () => {};
}

function readNoServers(): ServerChoicesSnapshot {
  return noServers;
}

export function useServerChoices(): ServerChoicesState | null {
  const choices = getServerChoices();
  const snapshot = useSyncExternalStore(
    choices?.subscribe ?? subscribeToNothing,
    choices?.getSnapshot ?? readNoServers,
  );
  useEffect(() => {
    choices?.refresh();
  }, [choices]);
  return useMemo(
    () =>
      choices === null
        ? null
        : {
            status: snapshot.status,
            servers: snapshot.servers,
            switchTo: choices.switchTo,
          },
    [choices, snapshot],
  );
}
