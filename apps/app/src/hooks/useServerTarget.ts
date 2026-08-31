import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BbDesktopApi,
  BbDesktopServerOption,
  BbDesktopServerTarget,
} from "@bb/desktop-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

export interface ServerTargetState {
  available: boolean;
  busy: boolean;
  canManageServers: boolean;
  connectTrusted: boolean;
  selectedServer: BbDesktopServerOption | null;
  showConnectHint: boolean;
  target: BbDesktopServerTarget | null;
  addCustomServer: (name: string, url: string) => Promise<boolean>;
  removeCustomServer: (serverId: string) => Promise<boolean>;
  selectServer: (serverId: string) => void;
  setConnectTrusted: (trusted: boolean) => Promise<boolean>;
}

function hasSelectableServerBeyondBuiltin(
  servers: readonly BbDesktopServerOption[],
): boolean {
  return servers.some((server) => server.kind !== "builtin");
}

export function useServerTarget(): ServerTargetState {
  const [desktopApi] = useState<BbDesktopApi | null>(() => getBbDesktopInfo());
  const [target, setTarget] = useState<BbDesktopServerTarget | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const getServerTarget = desktopApi?.experimental_getServerTarget;
    const onServerTargetChange = desktopApi?.experimental_onServerTargetChange;
    if (
      desktopApi === null ||
      getServerTarget === undefined ||
      onServerTargetChange === undefined
    ) {
      return;
    }
    let mounted = true;
    void getServerTarget
      .call(desktopApi)
      .then((next) => {
        if (mounted && next !== null) {
          setTarget(next);
        }
      })
      .catch(() => undefined);
    const unsubscribe = onServerTargetChange.call(desktopApi, setTarget);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [desktopApi]);

  const selectServer = useCallback(
    (serverId: string) => {
      const setServerTarget = desktopApi?.experimental_setServerTarget;
      if (desktopApi === null || setServerTarget === undefined) {
        return;
      }
      setBusy(true);
      void setServerTarget
        .call(desktopApi, serverId)
        .catch(() => undefined)
        .finally(() => setBusy(false));
    },
    [desktopApi],
  );

  const runMutation = useCallback(
    async (
      mutate: (api: BbDesktopApi) => Promise<boolean>,
    ): Promise<boolean> => {
      if (desktopApi === null) {
        return false;
      }
      setBusy(true);
      try {
        return await mutate(desktopApi);
      } catch {
        return false;
      } finally {
        setBusy(false);
      }
    },
    [desktopApi],
  );

  const addCustomServer = useCallback(
    (name: string, url: string): Promise<boolean> =>
      runMutation((api) =>
        api.experimental_addCustomServer === undefined
          ? Promise.resolve(false)
          : api.experimental_addCustomServer(name, url),
      ),
    [runMutation],
  );

  const removeCustomServer = useCallback(
    (serverId: string): Promise<boolean> =>
      runMutation((api) =>
        api.experimental_removeCustomServer === undefined
          ? Promise.resolve(false)
          : api.experimental_removeCustomServer(serverId),
      ),
    [runMutation],
  );

  const setConnectTrusted = useCallback(
    (trusted: boolean): Promise<boolean> =>
      runMutation((api) =>
        api.experimental_setConnectTrusted === undefined
          ? Promise.resolve(false)
          : api.experimental_setConnectTrusted(trusted),
      ),
    [runMutation],
  );

  const selectedServer = useMemo(
    () => target?.servers.find((server) => server.selected) ?? null,
    [target],
  );

  const showConnectHint =
    target !== null &&
    target.connectServersSkipReason !== null &&
    !hasSelectableServerBeyondBuiltin(target.servers);

  return {
    available: desktopApi?.experimental_getServerTarget !== undefined,
    busy,
    canManageServers: target?.canManageServers ?? false,
    connectTrusted: target?.connectTrusted ?? true,
    selectedServer,
    showConnectHint,
    target,
    addCustomServer,
    removeCustomServer,
    selectServer,
    setConnectTrusted,
  };
}
