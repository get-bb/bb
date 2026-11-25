import {
  bbDesktopConnectSignInLabel,
  type BbDesktopServerChoice,
  type BbDesktopServerList,
} from "@bb/desktop-contract";
import { getNativeShell } from "./native-shell";

export type ServerChoice = BbDesktopServerChoice;

export interface AccountSignIn {
  label: string;
  start(): void;
}

export interface ServerChoicesSnapshot {
  status: "loading" | "ready";
  servers: readonly ServerChoice[];
  accountSignIn: AccountSignIn | null;
}

export interface ServerChoices {
  getSnapshot(): ServerChoicesSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): void;
  switchTo(id: string): void;
  addServer: (() => void) | null;
}

interface ServerList {
  servers: readonly ServerChoice[];
  connectServersSkipReason: BbDesktopServerList["connectServersSkipReason"];
}

interface ServerChoiceSource {
  initial: ServerList | null;
  load(): Promise<ServerList>;
  watch(listener: (list: ServerList) => void): void;
  switchTo(id: string): void;
  addServer: (() => void) | null;
  signInToConnect: (() => void) | null;
}

function sameServerList(left: ServerList, right: ServerList): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createServerChoices(source: ServerChoiceSource): ServerChoices {
  const toSnapshot = (list: ServerList | null): ServerChoicesSnapshot => {
    if (list === null)
      return { status: "loading", servers: [], accountSignIn: null };
    const label = bbDesktopConnectSignInLabel(list.connectServersSkipReason);
    return {
      status: "ready",
      servers: list.servers,
      accountSignIn:
        label === null || source.signInToConnect === null
          ? null
          : { label, start: source.signInToConnect },
    };
  };
  let current = source.initial;
  let snapshot = toSnapshot(current);
  let changes = 0;
  const listeners = new Set<() => void>();
  const publish = (list: ServerList) => {
    if (current !== null && sameServerList(current, list)) return;
    current = list;
    snapshot = toSnapshot(list);
    for (const listener of listeners) listener();
  };
  source.watch((list) => {
    changes += 1;
    publish(list);
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
        (list) => {
          if (changes === changesBefore) publish(list);
        },
        () => {
          if (current === null)
            publish({ servers: [], connectServersSkipReason: null });
        },
      );
    },
    switchTo: (id) => source.switchTo(id),
    addServer: source.addServer,
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
  const getServerList = desktop?.getServerList?.bind(desktop);
  const onServerListChange = desktop?.onServerListChange?.bind(desktop);
  return {
    initial: null,
    load:
      getServerList ??
      (async () => ({
        servers: await listServerChoices(),
        connectServersSkipReason: null,
      })),
    watch: (listener) => {
      if (onServerListChange !== undefined) {
        onServerListChange(listener);
        return;
      }
      onServerChoicesChange((servers) =>
        listener({ servers, connectServersSkipReason: null }),
      );
    },
    switchTo: selectServer,
    addServer: desktop?.addServer?.bind(desktop) ?? null,
    signInToConnect: desktop?.signInToConnect?.bind(desktop) ?? null,
  };
}

function mobileSource(): ServerChoiceSource | null {
  const shell = getNativeShell();
  const initial = shell?.servers() ?? null;
  if (shell === null || initial === null) return null;
  const toList = (servers: readonly ServerChoice[]): ServerList => ({
    servers,
    connectServersSkipReason: null,
  });
  return {
    initial: toList(initial),
    load: async () => toList(shell.servers() ?? []),
    watch: (listener) => {
      shell.subscribe((event) => {
        if (event.type === "servers") listener(toList(event.servers));
      });
    },
    switchTo: (id) => shell.post({ type: "switch-server", id }),
    addServer:
      shell.has("open-native") && shell.handshake.bridgeVersion >= 5
        ? () => shell.post({ type: "open-native", screen: "add-server" })
        : null,
    signInToConnect: null,
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
