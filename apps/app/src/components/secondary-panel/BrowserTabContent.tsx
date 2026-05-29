import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAtomValue } from "jotai";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserState,
  BbDesktopBrowserViewBounds,
} from "@bb/server-contract";
import { Icon } from "@/components/ui/icon.js";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import {
  getBrowserUrlSecurity,
  resolveBrowserAddressInput,
} from "@/lib/browser-url";
import { useBrowserHistory } from "@/lib/browser-history";
import { threadSecondaryPanelResizingAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { BrowserNewTabScreen } from "./BrowserNewTabScreen";
import type { UpdateBrowserTabArgs } from "./useThreadFileTabs";

export interface BrowserTabContentProps {
  tabId: string;
  initialUrl: string;
  threadId: string;
  onUpdate: (args: UpdateBrowserTabArgs) => void;
}

interface BrowserChromeProps {
  addressDraft: string;
  isEditing: boolean;
  state: BbDesktopBrowserState | null;
  currentUrl: string;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  onForward: () => void;
  onReloadOrStop: () => void;
}

interface NavButtonProps {
  icon: "ChevronLeft" | "ChevronRight" | "RotateCcw" | "X";
  label: string;
  disabled?: boolean;
  onClick: () => void;
}

function roundedBoundsFromRect(rect: DOMRect): BbDesktopBrowserViewBounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function NavButton({ icon, label, disabled, onClick }: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
    >
      <Icon name={icon} className="size-4" aria-hidden />
    </button>
  );
}

function BrowserChrome({
  addressDraft,
  isEditing,
  state,
  currentUrl,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onSubmit,
  onBack,
  onForward,
  onReloadOrStop,
}: BrowserChromeProps) {
  const isLoading = state?.isLoading ?? false;
  const security = getBrowserUrlSecurity(currentUrl);
  const addressValue = isEditing ? addressDraft : currentUrl;

  return (
    <div className="relative flex items-center gap-1 border-b border-border bg-card px-2 py-1.5">
      <NavButton
        icon="ChevronLeft"
        label="Go back"
        disabled={!(state?.canGoBack ?? false)}
        onClick={onBack}
      />
      <NavButton
        icon="ChevronRight"
        label="Go forward"
        disabled={!(state?.canGoForward ?? false)}
        onClick={onForward}
      />
      <NavButton
        icon={isLoading ? "X" : "RotateCcw"}
        label={isLoading ? "Stop loading" : "Reload"}
        onClick={onReloadOrStop}
      />
      <form onSubmit={onSubmit} className="min-w-0 flex-1">
        <div className="flex h-8 items-center gap-2 rounded-full border border-border bg-background px-3">
          {security === "secure" ? (
            <Icon
              name="Lock"
              className="size-3.5 shrink-0 text-success"
              aria-label="Secure connection"
            />
          ) : security === "insecure" ? (
            <Icon
              name="AlertTriangle"
              className="size-3.5 shrink-0 text-warning"
              aria-label="Connection not secure"
            />
          ) : (
            <Icon
              name="Search"
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
          <input
            type="text"
            value={addressValue}
            onChange={(event) => onAddressChange(event.target.value)}
            onFocus={onAddressFocus}
            onBlur={onAddressBlur}
            placeholder="Search or enter address"
            aria-label="Address and search bar"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground"
          />
        </div>
      </form>
      {isLoading ? (
        <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
          <span className="block h-full w-1/3 animate-pulse bg-ring" />
        </span>
      ) : null}
    </div>
  );
}

function BrowserUnavailable() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
        <Icon name="Globe" className="size-6" aria-hidden />
      </span>
      <div className="text-sm font-medium text-foreground">
        Browser tabs need the desktop app
      </div>
      <p className="max-w-xs text-xs text-muted-foreground">
        The in-app web browser runs in the bb desktop app. Open this thread there
        to browse the web.
      </p>
    </div>
  );
}

export function BrowserTabContent({
  tabId,
  initialUrl,
  threadId,
  onUpdate,
}: BrowserTabContentProps) {
  const desktopBrowser = useMemo<BbDesktopBrowserApi | null>(
    () => getDesktopBrowserApi(),
    [],
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const isResizing = useAtomValue(threadSecondaryPanelResizingAtom);
  const { entries: recent, recordVisit, clear: clearRecent } =
    useBrowserHistory(threadId);

  const [state, setState] = useState<BbDesktopBrowserState | null>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [addressDraft, setAddressDraft] = useState(initialUrl);
  const [isEditing, setIsEditing] = useState(false);

  // Keep the latest persistence/visit callbacks in refs so the attach effect can
  // run once per tab without re-subscribing when these identities change.
  const onUpdateRef = useRef(onUpdate);
  const recordVisitRef = useRef(recordVisit);
  onUpdateRef.current = onUpdate;
  recordVisitRef.current = recordVisit;
  // The URL to load when the view is first created. Captured once so navigation
  // (which updates the persisted `initialUrl` prop) never re-runs the attach
  // effect — switching to a different tab remounts via `key`, which is correct.
  const initialUrlRef = useRef(initialUrl);

  const hasPage = currentUrl.length > 0;

  const syncBounds = useCallback(() => {
    const element = contentRef.current;
    if (element === null || desktopBrowser === null) {
      return;
    }
    desktopBrowser.setBounds({
      tabId,
      bounds: roundedBoundsFromRect(element.getBoundingClientRect()),
    });
  }, [desktopBrowser, tabId]);

  // Create the native view on mount, stream navigation state back, and tear it
  // down on unmount. The view is destroyed (not just hidden) on unmount, so the
  // lifecycle stays leak-free; the persisted URL re-loads the page on return.
  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }
    const element = contentRef.current;
    const initialBounds =
      element !== null
        ? roundedBoundsFromRect(element.getBoundingClientRect())
        : { x: 0, y: 0, width: 0, height: 0 };
    const mountUrl = initialUrlRef.current;
    desktopBrowser.attach({
      tabId,
      url: mountUrl,
      bounds: initialBounds,
      visible: mountUrl.length > 0,
    });

    const unsubscribe = desktopBrowser.onState((nextState) => {
      if (nextState.tabId !== tabId) {
        return;
      }
      setState(nextState);
      setCurrentUrl(nextState.url);
      onUpdateRef.current({
        tabId,
        url: nextState.url,
        title: nextState.title,
      });
      if (!nextState.isLoading && nextState.url.length > 0) {
        recordVisitRef.current({
          url: nextState.url,
          title: nextState.title,
        });
      }
    });

    return () => {
      unsubscribe();
      desktopBrowser.detach(tabId);
    };
  }, [desktopBrowser, tabId]);

  // Track the panel content rect so the native overlay stays aligned.
  useEffect(() => {
    const element = contentRef.current;
    if (element === null || desktopBrowser === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      syncBounds();
    });
    observer.observe(element);
    window.addEventListener("resize", syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [desktopBrowser, syncBounds]);

  // Hide the native view while the panel is being resized (it cannot clip to the
  // animating container) and whenever the new-tab screen is showing.
  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }
    desktopBrowser.setVisible({ tabId, visible: hasPage && !isResizing });
    if (hasPage && !isResizing) {
      syncBounds();
    }
  }, [desktopBrowser, tabId, hasPage, isResizing, syncBounds]);

  const navigateToInput = useCallback(
    (rawInput: string) => {
      const url = resolveBrowserAddressInput(rawInput);
      if (url === null) {
        return;
      }
      setCurrentUrl(url);
      setIsEditing(false);
      desktopBrowser?.navigate({ tabId, url });
    },
    [desktopBrowser, tabId],
  );

  const handleAddressSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      navigateToInput(addressDraft);
    },
    [addressDraft, navigateToInput],
  );

  const handleAddressFocus = useCallback(() => {
    setAddressDraft(currentUrl);
    setIsEditing(true);
  }, [currentUrl]);

  const handleReloadOrStop = useCallback(() => {
    if (state?.isLoading ?? false) {
      desktopBrowser?.stop(tabId);
      return;
    }
    desktopBrowser?.reload(tabId);
  }, [desktopBrowser, state?.isLoading, tabId]);

  if (desktopBrowser === null) {
    return <BrowserUnavailable />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BrowserChrome
        addressDraft={addressDraft}
        isEditing={isEditing}
        state={state}
        currentUrl={currentUrl}
        onAddressChange={setAddressDraft}
        onAddressFocus={handleAddressFocus}
        onAddressBlur={() => setIsEditing(false)}
        onSubmit={handleAddressSubmit}
        onBack={() => desktopBrowser.goBack(tabId)}
        onForward={() => desktopBrowser.goForward(tabId)}
        onReloadOrStop={handleReloadOrStop}
      />
      {state?.errorText != null && hasPage ? (
        <div className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {state.errorText}
        </div>
      ) : null}
      <div ref={contentRef} className="relative min-h-0 flex-1">
        {hasPage ? null : (
          <BrowserNewTabScreen
            onNavigateInput={navigateToInput}
            recent={recent}
            onClearRecent={clearRecent}
          />
        )}
      </div>
    </div>
  );
}
