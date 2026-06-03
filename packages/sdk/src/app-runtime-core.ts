import {
  appDataBroadcastMessageSchema,
  type AppCapability,
  type AppDataBroadcastMessage,
} from "@bb/server-contract";
import type {
  ApplicationId,
  AppDataPath,
  JsonValue,
} from "@bb/domain";
import { appDataPathSchema } from "@bb/domain";
import { createBbSdk, type BbSdk } from "./core.js";
import { createHttpTransport } from "./transport-http.js";
import type { FetchImplementation } from "./response.js";
import type { BbRealtimeSocketFactory } from "./transport.js";
import type {
  CurrentAppDataArea,
  CurrentAppDataChangeArgs,
  CurrentAppDataChangeEvent,
} from "./areas/apps.js";

export interface AppRuntimeBootstrap {
  appId: ApplicationId;
  applicationId: ApplicationId;
  appSessionToken: string | null;
  capabilities: AppCapability[];
  dataUrl: string;
  messageUrl: string;
  targetThreadId: string | null;
  wsUrl: string;
}

export interface CreateInjectedBbSdkArgs {
  bootstrap: AppRuntimeBootstrap;
  fetch?: FetchImplementation;
  websocket?: BbRealtimeSocketFactory;
}

interface CreateInjectedCurrentAppDataAreaArgs {
  baseDataArea: CurrentAppDataArea;
  bootstrap: AppRuntimeBootstrap;
  websocket?: BbRealtimeSocketFactory;
}

interface AppDataRealtimeEvent {
  deleted: boolean;
  path: AppDataPath;
  value: JsonValue | undefined;
  version?: string;
}

interface AppDataChangeListener {
  active: boolean;
  bufferedEvents: AppDataRealtimeEvent[];
  callback(event: CurrentAppDataChangeEvent): void;
  prefix: AppDataPath | "";
  replaying: boolean;
  replayPromise: Promise<void> | null;
}

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

interface PathMatchesPrefixArgs {
  path: AppDataPath;
  prefix: AppDataPath | "";
}

function cloneValue<TValue extends JsonValue | undefined>(
  value: TValue,
): TValue {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function prefixPath(input: AppDataPath | "" | undefined): AppDataPath | "" {
  const value = input ?? "";
  if (value === "") {
    return "";
  }
  return appDataPathSchema.parse(value);
}

function pathMatchesPrefix(args: PathMatchesPrefixArgs): boolean {
  return (
    args.prefix === "" ||
    args.path === args.prefix ||
    args.path.startsWith(`${args.prefix}/`)
  );
}

function createDefaultWebsocketFactory(): BbRealtimeSocketFactory {
  return (url) => new WebSocket(url);
}

export function createInjectedCurrentAppDataArea(
  args: CreateInjectedCurrentAppDataAreaArgs,
): CurrentAppDataArea {
  const data = args.baseDataArea;
  const websocketFactory =
    args.websocket ?? createDefaultWebsocketFactory();
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 1000;
  let socketHasOpened = false;
  let socketSubscribed = false;
  let subscriptionReady: Promise<void> | null = null;
  let resolveSubscriptionReady: (() => void) | null = null;
  let listeners: AppDataChangeListener[] = [];
  const subscriptionEntityId = `${args.bootstrap.applicationId}:data`;

  const callListener = (
    listener: AppDataChangeListener,
    event: AppDataRealtimeEvent,
  ) => {
    if (!listener.active) {
      return;
    }
    if (!pathMatchesPrefix({ path: event.path, prefix: listener.prefix })) {
      return;
    }
    try {
      listener.callback({
        deleted: event.deleted,
        path: event.path,
        value: event.deleted ? undefined : cloneValue(event.value),
      });
    } catch (error) {
      console.error("window.bb.data.onChange callback failed", error);
    }
  };

  const deliverOrBufferListener = (
    listener: AppDataChangeListener,
    event: AppDataRealtimeEvent,
  ) => {
    if (!listener.active) {
      return;
    }
    if (!pathMatchesPrefix({ path: event.path, prefix: listener.prefix })) {
      return;
    }
    if (listener.replaying) {
      listener.bufferedEvents.push(event);
      return;
    }
    callListener(listener, event);
  };

  const resetSubscriptionReady = () => {
    subscriptionReady = new Promise((resolve) => {
      resolveSubscriptionReady = resolve;
    });
  };

  const sendSubscriptionMessage = (type: "subscribe" | "unsubscribe") => {
    if (!socket || socket.readyState !== SOCKET_OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({
        type,
        entity: "app",
        id: subscriptionEntityId,
      }),
    );
  };

  const closeSocketIfIdle = () => {
    if (listeners.length > 0) {
      return;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (!socket) {
      return;
    }
    if (resolveSubscriptionReady) {
      resolveSubscriptionReady();
      resolveSubscriptionReady = null;
    }
    if (socket.readyState === SOCKET_OPEN && socketSubscribed) {
      sendSubscriptionMessage("unsubscribe");
      socketSubscribed = false;
    }
    if (
      socket.readyState === SOCKET_OPEN ||
      socket.readyState === SOCKET_CONNECTING
    ) {
      socketHasOpened = false;
      socket.close();
    }
  };

  const replayExisting = (
    listener: AppDataChangeListener,
  ): Promise<void> => {
    if (!listener.active) {
      return Promise.resolve();
    }
    listener.replayPromise = (
      listener.replayPromise ?? Promise.resolve()
    )
      .then(async () => {
        if (!listener.active) {
          return;
        }
        listener.replaying = true;
        listener.bufferedEvents = [];
        await connectSocket();
        if (!listener.active) {
          return;
        }
        const entries = await data.entries({ prefix: listener.prefix });
        if (!listener.active) {
          return;
        }
        const replayedVersions = new Map<string, string>();
        for (const entry of entries) {
          replayedVersions.set(entry.path, entry.version);
          callListener(listener, {
            deleted: false,
            path: entry.path,
            value: entry.value,
          });
        }
        for (const event of listener.bufferedEvents) {
          if (
            !event.deleted &&
            event.version !== undefined &&
            replayedVersions.get(event.path) === event.version
          ) {
            continue;
          }
          callListener(listener, event);
        }
      })
      .finally(() => {
        listener.replaying = false;
        listener.bufferedEvents = [];
      })
      .catch((error) => {
        if (!listener.active) {
          return;
        }
        console.error("window.bb.data.onChange replay failed", error);
      });
    return listener.replayPromise;
  };

  const handleBroadcast = (message: AppDataBroadcastMessage) => {
    if (message.applicationId !== args.bootstrap.applicationId) {
      return;
    }
    if (message.type === "app-data.resync") {
      for (const listener of listeners.slice()) {
        void replayExisting(listener);
      }
      return;
    }
    const event: AppDataRealtimeEvent = {
      deleted: message.deleted,
      path: message.path,
      value: message.deleted ? undefined : cloneValue(message.value),
      version: message.version ?? undefined,
    };
    for (const listener of listeners.slice()) {
      deliverOrBufferListener(listener, event);
    }
  };

  const connectSocket = (): Promise<void> => {
    if (!subscriptionReady) {
      resetSubscriptionReady();
    }
    const currentSubscriptionReady = subscriptionReady;
    if (!currentSubscriptionReady) {
      throw new Error("BB app data subscription was not initialized.");
    }
    if (
      socket &&
      (socket.readyState === SOCKET_OPEN ||
        socket.readyState === SOCKET_CONNECTING)
    ) {
      return currentSubscriptionReady;
    }
    socket = websocketFactory(args.bootstrap.wsUrl);
    socket.onopen = () => {
      const reconnected = socketHasOpened;
      socketHasOpened = true;
      reconnectDelay = 1000;
      if (listeners.length > 0) {
        sendSubscriptionMessage("subscribe");
        socketSubscribed = true;
      }
      if (resolveSubscriptionReady) {
        resolveSubscriptionReady();
        resolveSubscriptionReady = null;
      }
      closeSocketIfIdle();
      if (reconnected) {
        for (const listener of listeners.slice()) {
          void replayExisting(listener);
        }
      }
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      try {
        handleBroadcast(
          appDataBroadcastMessageSchema.parse(JSON.parse(event.data)),
        );
      } catch (error) {
        console.error("window.bb ignored invalid realtime message", error);
      }
    };
    socket.onclose = () => {
      socketSubscribed = false;
      resetSubscriptionReady();
      if (listeners.length === 0 || reconnectTimer) {
        return;
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnectDelay = Math.min(reconnectDelay * 1.5, 30_000);
        void connectSocket();
      }, reconnectDelay);
    };
    socket.onerror = () => {
      socket?.close();
    };
    return currentSubscriptionReady;
  };

  return {
    delete: data.delete,
    entries: data.entries,
    list: data.list,
    async read(input) {
      return data.read(input);
    },
    onChange(input: CurrentAppDataChangeArgs) {
      const listener: AppDataChangeListener = {
        active: true,
        bufferedEvents: [],
        callback: input.callback,
        prefix: prefixPath(input.prefix),
        replaying: false,
        replayPromise: null,
      };
      listeners.push(listener);
      void replayExisting(listener);
      return () => {
        if (!listener.active) {
          return;
        }
        listener.active = false;
        listener.bufferedEvents = [];
        listeners = listeners.filter((candidate) => candidate !== listener);
        closeSocketIfIdle();
      };
    },
    write: data.write,
  };
}

export function createInjectedBbSdk(
  args: CreateInjectedBbSdkArgs,
): BbSdk {
  const sdk = createBbSdk({
    context: {
      applicationId: args.bootstrap.applicationId,
      appSessionToken: args.bootstrap.appSessionToken ?? undefined,
      targetThreadId: args.bootstrap.targetThreadId ?? undefined,
    },
    transport: createHttpTransport({
      fetch: args.fetch,
      runtime: "injected-app",
      websocket: args.websocket,
    }),
  });

  return {
    ...sdk,
    data: createInjectedCurrentAppDataArea({
      baseDataArea: sdk.data,
      bootstrap: args.bootstrap,
      websocket: args.websocket,
    }),
  };
}
