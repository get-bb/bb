import { useCallback, useRef, useState, type ReactNode } from "react";
import { render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SidebarNavigationModelProvider } from "@/components/sidebar/SidebarNavigationModel";
import {
  resolveCustomizeFocusReturnTarget,
  SidebarNavigationRegion,
} from "@/components/sidebar/SidebarNavigationRegion";

type JotaiStore = ReturnType<typeof createStore>;

export interface NavigationHarnessOptions {
  store?: JotaiStore;
  initialEntries?: string[];
  compactViewport?: boolean;
  splitEnabled?: boolean;
  onNewChat?: () => void;
  onSearchThreads?: () => void;
  onNavigate?: () => void;
  onCustomizingChange?: (isCustomizing: boolean) => void;
  children?: ReactNode;
}

function noop() {}

export function NavigationLocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location-path">{location.pathname}</output>
      <button type="button" onClick={() => void navigate(-1)}>
        History back
      </button>
      <button type="button" onClick={() => void navigate(1)}>
        History forward
      </button>
    </>
  );
}

function NavigationHarnessSidebar({
  options,
}: {
  options: NavigationHarnessOptions;
}) {
  const [isCustomizing, setCustomizing] = useState(false);
  const focusReturnTargetRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { onCustomizingChange, onNavigate } = options;
  const changeCustomizing = useCallback(
    (next: boolean) => {
      setCustomizing(next);
      onCustomizingChange?.(next);
    },
    [onCustomizingChange],
  );
  return (
    <div ref={containerRef} data-testid="navigation-harness-sidebar">
      <SidebarNavigationModelProvider
        onNewChat={options.onNewChat ?? noop}
        onSearchThreads={options.onSearchThreads ?? noop}
        onOpenCustomize={() => {
          focusReturnTargetRef.current = resolveCustomizeFocusReturnTarget(
            containerRef.current,
          );
          changeCustomizing(true);
        }}
        splitEnabled={options.splitEnabled ?? false}
        {...(onNavigate ? { onNavigate } : {})}
      >
        <SidebarNavigationRegion
          isCustomizing={isCustomizing}
          onCustomizingChange={changeCustomizing}
          focusReturnTargetRef={focusReturnTargetRef}
          {...(onNavigate ? { onNavigate } : {})}
        />
      </SidebarNavigationModelProvider>
    </div>
  );
}

export function renderNavigationHarness(
  options: NavigationHarnessOptions = {},
) {
  const store = options.store ?? createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <CompactViewportOverrideProvider
      isCompactViewport={options.compactViewport ?? false}
    >
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <MemoryRouter initialEntries={options.initialEntries ?? ["/"]}>
            <SidebarProvider>
              <NavigationHarnessSidebar options={options} />
              <NavigationLocationProbe />
              {options.children}
            </SidebarProvider>
          </MemoryRouter>
        </Provider>
      </QueryClientProvider>
    </CompactViewportOverrideProvider>,
  );
  return { ...view, store };
}
