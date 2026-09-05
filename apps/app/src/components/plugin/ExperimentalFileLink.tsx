import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { ExperimentalFileLinkProps } from "@get-bb/plugin-sdk";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { RouteAnchor } from "@/components/ui/app-route-anchor";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { normalizeExperimentalFileOpenOptions } from "@/lib/live-file-navigation";

const LazyExperimentalFileLinkMenu = lazy(() =>
  import("./ExperimentalFileLinkMenu").then(({ ExperimentalFileLinkMenu }) => ({
    default: ExperimentalFileLinkMenu,
  })),
);

function shouldHandleFileClick(
  event: ReactMouseEvent<HTMLAnchorElement>,
): boolean {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.currentTarget.hasAttribute("download")
  );
}

export function ExperimentalFileLink({
  target,
  location = null,
  onClick,
  onAuxClick,
  onKeyDown,
  ...anchorProps
}: ExperimentalFileLinkProps) {
  const navigation = useAppNavigationHost();
  const [isMenuOpen, setMenuOpen] = useState(false);
  const intent = useMemo(
    () => normalizeExperimentalFileOpenOptions({ target, location }),
    [location, target],
  );
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      const shouldOpen = intent !== null && shouldHandleFileClick(event);
      event.preventDefault();
      if (!shouldOpen) return;
      navigation.openFilePreview(intent);
    },
    [intent, navigation, onClick],
  );
  const anchor = (
    <RouteAnchor
      {...anchorProps}
      href={undefined}
      role={intent === null ? undefined : "link"}
      tabIndex={intent === null ? undefined : (anchorProps.tabIndex ?? 0)}
      onClick={handleClick}
      onAuxClick={(event) => {
        onAuxClick?.(event);
        event.preventDefault();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === "Enter" && !event.defaultPrevented) {
          event.preventDefault();
          if (
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey
          )
            event.currentTarget.click();
        }
      }}
    />
  );

  if (intent === null) return anchor;
  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>{anchor}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        {isMenuOpen ? (
          <Suspense
            fallback={<ContextMenuItem disabled>Loading…</ContextMenuItem>}
          >
            <LazyExperimentalFileLinkMenu intent={intent} />
          </Suspense>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
