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
  selectedServer: BbDesktopServerOption | null;
  showConnectHint: boolean;
  target: BbDesktopServerTarget | null;
  selectServer: (serverId: string) => void;
  setCustomServerUrl: (url: string | null) => Promise<boolean>;
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

  const setCustomServerUrl = useCallback(
    async (url: string | null): Promise<boolean> => {
      const setUrl = desktopApi?.experimental_setCustomServerUrl;
      if (desktopApi === null || setUrl === undefined) {
        return false;
      }
      setBusy(true);
      try {
        return await setUrl.call(desktopApi, url);
      } catch {
        return false;
      } finally {
        setBusy(false);
      }
    },
    [desktopApi],
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
    selectedServer,
    showConnectHint,
    target,
    selectServer,
    setCustomServerUrl,
  };
}
