import type { BbDesktopServerChoice } from "@bb/desktop-contract";
import { getNativeShell } from "./native-shell";

export type ServerChoice = BbDesktopServerChoice;

export interface ServerChoicesSnapshot {
  status: "loading" | "ready";
  servers: readonly ServerChoice[];
}

export interface ServerChoices {
  getSnapshot(): ServerChoicesSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): void;
  switchTo(id: string): void;
}

interface ServerChoiceSource {
  initial: readonly ServerChoice[] | null;
  load(): Promise<readonly ServerChoice[]>;
  watch(listener: (choices: readonly ServerChoice[]) => void): void;
  switchTo(id: string): void;
}

function sameServers(
  left: readonly ServerChoice[],
  right: readonly ServerChoice[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createServerChoices(source: ServerChoiceSource): ServerChoices {
  let snapshot: ServerChoicesSnapshot =
    source.initial === null
      ? { status: "loading", servers: [] }
      : { status: "ready", servers: source.initial };
  let changes = 0;
  const listeners = new Set<() => void>();
  const publish = (servers: readonly ServerChoice[]) => {
    if (snapshot.status === "ready" && sameServers(snapshot.servers, servers))
      return;
    snapshot = { status: "ready", servers };
    for (const listener of listeners) listener();
  };
  source.watch((servers) => {
    changes += 1;
    publish(servers);
  });
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh() {
      const changesBefore = changes;
      void source.load().then(
        (servers) => {
          if (changes === changesBefore) publish(servers);
        },
        () => {
          if (snapshot.status === "loading") publish([]);
        },
      );
    },
    switchTo: (id) => source.switchTo(id),
  };
}

function desktopSource(): ServerChoiceSource | null {
  const desktop = typeof window === "undefined" ? undefined : window.bbDesktop;
  const listServerChoices = desktop?.listServerChoices?.bind(desktop);
  const onServerChoicesChange = desktop?.onServerChoicesChange?.bind(desktop);
  const selectServer = desktop?.selectServer?.bind(desktop);
  if (
    listServerChoices === undefined ||
    onServerChoicesChange === undefined ||
    selectServer === undefined
  ) {
    return null;
  }
  return {
    initial: null,
    load: listServerChoices,
    watch: (listener) => {
      onServerChoicesChange(listener);
    },
    switchTo: selectServer,
  };
}

function mobileSource(): ServerChoiceSource | null {
  const shell = getNativeShell();
  const initial = shell?.servers() ?? null;
  if (shell === null || initial === null) return null;
  return {
    initial,
    load: async () => shell.servers() ?? [],
    watch: (listener) => {
      shell.subscribe((event) => {
        if (event.type === "servers") listener(event.servers);
      });
    },
    switchTo: (id) => shell.post({ type: "switch-server", id }),
  };
}

let cached: ServerChoices | null | undefined;

export function getServerChoices(): ServerChoices | null {
  if (cached === undefined) {
    const source = desktopSource() ?? mobileSource();
    cached = source === null ? null : createServerChoices(source);
  }
  return cached;
}

export function resetServerChoicesForTests(): void {
  cached = undefined;
}
