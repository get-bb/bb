import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserFindResult,
} from "@bb/desktop-contract";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";

interface BrowserFindState {
  query: string;
  result: BbDesktopBrowserFindResult | null;
}

interface UseBrowserFindArgs {
  active: boolean;
  currentUrl: string;
  desktopBrowser: BbDesktopBrowserApi | null;
  tabId: string;
}

export function useBrowserFind({
  active,
  currentUrl,
  desktopBrowser,
  tabId,
}: UseBrowserFindArgs) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousUrlRef = useRef(currentUrl);
  const [state, setState] = useState<BrowserFindState | null>(null);
  const supported =
    desktopBrowser?.find !== undefined &&
    desktopBrowser.stopFind !== undefined &&
    desktopBrowser.onFindResult !== undefined;

  const stop = useCallback(
    (focusPage: boolean) => {
      desktopBrowser?.stopFind?.({ tabId, focusPage });
      setState(null);
    },
    [desktopBrowser, tabId],
  );

  const open = useCallback((): boolean => {
    if (!active || currentUrl.length === 0 || !supported) {
      return false;
    }
    setState((current) => current ?? { query: "", result: null });
    window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      inputRef.current?.select();
    });
    return true;
  }, [active, currentUrl, supported]);

  useAppCommandHandler("browser.find", open, 100);

  useEffect(() => {
    if (previousUrlRef.current === currentUrl) {
      return;
    }
    previousUrlRef.current = currentUrl;
    stop(false);
  }, [currentUrl, stop]);

  useEffect(() => {
    const unsubscribe = desktopBrowser?.onFindResult?.((result) => {
      if (result.tabId !== tabId) {
        return;
      }
      setState((current) => (current === null ? null : { ...current, result }));
    });
    return () => {
      desktopBrowser?.stopFind?.({ tabId, focusPage: false });
      unsubscribe?.();
    };
  }, [desktopBrowser, tabId]);

  const setQuery = useCallback(
    (query: string) => {
      setState({ query, result: null });
      if (query.length === 0) {
        desktopBrowser?.stopFind?.({ tabId, focusPage: false });
        return;
      }
      desktopBrowser?.find?.({ tabId, text: query, forward: true });
    },
    [desktopBrowser, tabId],
  );

  const move = useCallback(
    (forward: boolean) => {
      if (state?.query) {
        desktopBrowser?.find?.({ tabId, text: state.query, forward });
      }
    },
    [desktopBrowser, state?.query, tabId],
  );

  const close = useCallback(() => stop(true), [stop]);

  return {
    close,
    inputRef,
    move,
    setQuery,
    state,
  };
}
