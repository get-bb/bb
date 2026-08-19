import { useState, type ComponentProps, type ReactNode } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginHomepageSections } from "@/components/plugin/PluginHomepageSections";
import { usePluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { SecondaryPanelLayout } from "@/components/secondary-panel/SecondaryPanelLayout";
import { LazyThreadSecondaryPanel } from "@/components/secondary-panel/lazySecondaryPanelComponents";
import { PAGE_SHELL_CONTENT_STYLE } from "@/components/ui/page-shell-content-style.js";
import {
  CHROME_ROW_HEIGHT_CLASS,
  getBbDesktopInfo,
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { useOptionalPaneContext } from "./thread-detail/PaneContext";

const ROOT_COMPOSE_MAX_WIDTH_CLASS = "max-w-[760px]";

// Where root compose pins its right-panel toggle in the viewport corner (see
// rootPanelToggle in RootComposeView, which passes its selected position here).
// The window
// drag strip below must carve this same footprint back out of the macOS drag
// region while the panel is closed: Electron resolves app-regions in DOM order
// (later wins), and the strip renders after the fixed toggle, so a no-drag on
// the toggle itself would just be re-added by the strip's own drag rect. The
// carve has to live inside the strip, and this constant keeps the two footprints
// from drifting apart.
// The toggle is `fixed`, so it positions against the viewport, whose origin
// is under the translucent status bar in an iOS standalone PWA. Without the
// safe-area insets it lands on the status bar and collides with the battery.
// The insets are 0 everywhere else, so desktop and Safari keep the same
// offsets.
//
// The top offset centers the toggle on the same axis as the pinned sidebar
// trigger, which CHROME_ROW_CLASS box-centers in a 48px row (center = 24px).
// The button box is 28px normally and 36px under a coarse pointer, so the
// offset has to change with it: 24 - 28/2 = 10px, and 24 - 36/2 = 6px. A single
// offset lines up in one pointer mode and sits 4px low in the other.
export const ROOT_COMPOSE_PINNED_PANEL_TOGGLE_POSITION_CLASS =
  "right-[calc(1rem+env(safe-area-inset-right))] top-[calc(0.625rem+env(safe-area-inset-top))] max-md:pointer-coarse:top-[calc(0.375rem+env(safe-area-inset-top))]";

type RootSecondaryPanelProps = Omit<
  ComponentProps<typeof LazyThreadSecondaryPanel>,
  | "browserDeck"
  | "drawerFallback"
  | "isConversationCollapsed"
  | "onToggleConversationCollapse"
  | "renderAsDrawer"
  | "showNewTabButton"
> & {
  renderBrowserDeck?: (args: {
    canShowNativeBrowserView: boolean;
  }) => ReactNode;
};

interface RootComposeSecondaryContentProps {
  children: ReactNode;
  contentClassName?: string;
  isSecondaryPanelOpen: boolean;
  onToggleSecondaryPanel: () => void;
  panelTogglePositionClassName: string;
  secondaryPanel: RootSecondaryPanelProps;
}

function DrawerPanelLoadingSkeleton() {
  return (
    <div
      data-testid="drawer-panel-loading-skeleton"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4"
    >
      <Skeleton className="h-8 w-40 rounded-md" />
      <Skeleton className="h-24 w-full rounded-md" />
      <Skeleton className="h-24 w-full rounded-md" />
    </div>
  );
}

export function RootComposeSecondaryContent({
  children,
  contentClassName,
  isSecondaryPanelOpen,
  onToggleSecondaryPanel,
  panelTogglePositionClassName,
  secondaryPanel,
}: RootComposeSecondaryContentProps) {
  const paneContext = useOptionalPaneContext();
  const secondaryPanelHost = paneContext?.secondaryPanelHost ?? null;
  const composerHost = usePluginComposerHost();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  // A bounded pane below a horizontal split is not part of the native window
  // chrome. Marking its top as draggable creates an invisible Electron hit-test
  // strip that consumes pointer input over portaled menus.
  const rendersWindowDragStrip =
    usesDesktopChrome && paneContext?.isTopRow !== false;
  const { renderBrowserDeck, ...threadSecondaryPanelProps } = secondaryPanel;

  const mainContent = (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {rendersWindowDragStrip ? (
        <div
          data-testid="root-compose-main-window-drag-strip"
          aria-hidden="true"
          className={cn(
            "absolute inset-x-0 top-0 z-10 shrink-0",
            CHROME_ROW_HEIGHT_CLASS,
            MACOS_WINDOW_DRAG_CLASS,
          )}
        >
          {!isSecondaryPanelOpen && secondaryPanelHost === null ? (
            <div
              data-testid="root-compose-drag-strip-toggle-cutout"
              className={cn(
                "absolute",
                panelTogglePositionClassName,
                COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
                MACOS_APP_REGION_NO_DRAG_CLASS,
              )}
            />
          ) : null}
        </div>
      ) : null}
      <div className="@container/page min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto flex w-full flex-col px-4 pb-4 pt-2",
            ROOT_COMPOSE_MAX_WIDTH_CLASS,
            contentClassName,
          )}
          style={PAGE_SHELL_CONTENT_STYLE}
        >
          {children}
          <PluginHomepageSections />
        </div>
      </div>
    </div>
  );

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-clip md:-mx-5 md:-mb-5 md:-mt-5">
      <SecondaryPanelLayout
        open={isSecondaryPanelOpen}
        onToggle={onToggleSecondaryPanel}
        onClose={threadSecondaryPanelProps.onClose}
        resetKey="new-thread"
        contentKey="new-thread"
        drawerLabel="Right panel"
        drawerFallback={<DrawerPanelLoadingSkeleton />}
        mainPanelId="root-compose-main-panel"
        main={mainContent}
        composerHost={composerHost}
        renderPanel={({
          presentation,
          canShowNativeBrowserView,
          onToggleMainCollapse,
          resizablePanelId,
        }) => (
          <LazyThreadSecondaryPanel
            {...threadSecondaryPanelProps}
            drawerFallback={<DrawerPanelLoadingSkeleton />}
            browserDeck={renderBrowserDeck?.({ canShowNativeBrowserView })}
            renderAsDrawer={presentation === "drawer"}
            isConversationCollapsed={false}
            onToggleConversationCollapse={onToggleMainCollapse}
            showNewTabButton
            resizablePanelId={resizablePanelId}
          />
        )}
      />
    </div>
  );
}
