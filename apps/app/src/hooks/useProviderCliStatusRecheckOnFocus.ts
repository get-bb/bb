import { focusManager, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { refreshHostProviderCliStatus } from "@/hooks/cache-owners/provider-cli-status-cache-owner";

export function useProviderCliStatusRecheckOnFocus(args: {
  hostId: string | null;
  blocked: boolean;
}): void {
  const queryClient = useQueryClient();
  const { hostId, blocked } = args;
  useEffect(() => {
    if (!blocked || hostId === null) return;
    let running = false;
    const recheck = () => {
      if (running || !focusManager.isFocused()) return;
      running = true;
      void refreshHostProviderCliStatus({ queryClient, hostId }).finally(() => {
        running = false;
      });
    };
    const unsubscribe = focusManager.subscribe(recheck);
    window.addEventListener("focus", recheck);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", recheck);
    };
  }, [blocked, hostId, queryClient]);
}
