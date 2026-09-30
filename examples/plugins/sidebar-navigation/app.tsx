import { useState } from "react";
import {
  definePluginApp,
  experimental_SidebarNavigationIcon as NavigationIcon,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  type ExperimentalSidebarNavigationItem,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";

function NavigationButton({
  item,
}: {
  item: ExperimentalSidebarNavigationItem;
}) {
  const { activeItemId, actions } = experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  return (
    <button
      type="button"
      disabled={item.isDisabled || item.isLoading}
      aria-current={item.id === activeItemId ? "page" : undefined}
      aria-keyshortcuts={item.shortcut?.ariaKeyShortcuts}
      title={item.shortcut?.label}
      className="flex min-w-0 items-center gap-2 rounded-md border border-sidebar-border px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent disabled:opacity-50 aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium"
      {...split.splitProps}
      onClick={(event) =>
        actions.activate(item.id, {
          openInSplit: event.metaKey || event.ctrlKey,
        })
      }
      onContextMenu={(event) => {
        event.preventDefault();
        actions.setVisible(item.id, false);
      }}
    >
      <NavigationIcon icon={item.icon} className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{item.label}</span>
    </button>
  );
}

function SidebarNavigation({
  experimental_Original: Original,
  isCompactViewport,
}: ExperimentalSidebarNavigationProps) {
  const { actions, items } = experimental_useSidebarNavigation();
  const hidden = items.filter((item) => !item.isVisible);
  const [showOriginal, setShowOriginal] = useState(false);
  const [shouldCrash, setShouldCrash] = useState(false);
  if (shouldCrash) throw new Error("Example navigation crash");

  if (showOriginal) {
    return (
      <section data-testid="sidebar-navigation-example-original">
        <div className="px-2 pt-2">
          <button
            type="button"
            className="w-full rounded-md border border-sidebar-border px-2 py-1.5 text-left text-xs text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => setShowOriginal(false)}
          >
            Return to custom navigation
          </button>
        </div>
        <Original />
      </section>
    );
  }

  return (
    <section
      data-testid="sidebar-navigation-example"
      aria-label="Custom sidebar navigation"
      className="space-y-2 px-2 py-2 text-sidebar-foreground"
    >
      <div className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
        <strong className="mr-auto font-medium text-sidebar-foreground">
          Garden navigation
        </strong>
        <span>{isCompactViewport ? "Compact" : "Desktop"}</span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {items
          .filter((item) => item.isVisible)
          .map((item) => (
            <NavigationButton key={item.id} item={item} />
          ))}
      </div>
      {hidden.length > 0 ? (
        <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
          <span>Hidden:</span>
          {hidden.map((item) => (
            <button
              key={item.id}
              type="button"
              className="rounded-md px-1 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={() => actions.setVisible(item.id, true)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-1 border-t border-sidebar-border pt-2">
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={() => actions.openCustomize()}
        >
          Customize
        </button>
        <button
          type="button"
          className="flex-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={() => setShowOriginal(true)}
        >
          Use BB navigation
        </button>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-destructive"
          onClick={() => setShouldCrash(true)}
        >
          Test fallback
        </button>
      </div>
    </section>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "garden",
    title: "Garden navigation",
    description: "A compact grid for the host sidebar destinations.",
    component: SidebarNavigation,
  });
});
