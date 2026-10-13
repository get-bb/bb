import {
  useCallback,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  ExperimentalFileLinkProps,
  ExperimentalFileOpenOptions,
} from "@get-bb/plugin-sdk";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { RouteAnchor } from "@/components/ui/app-route-anchor";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { normalizeExperimentalFileOpenOptions } from "@/lib/live-file-navigation";
import { defineSplit } from "@/lib/define-split";

const LazyExperimentalFileLinkMenu = defineSplit<{
  intent: ExperimentalFileOpenOptions;
}>({
  id: "experimental-file-link-menu",
  load: () =>
    import("./ExperimentalFileLinkMenu").then(
      (module) => module.ExperimentalFileLinkMenu,
    ),
  loading: () => <ContextMenuItem disabled>Loading…</ContextMenuItem>,
  tier: "intent",
});

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
      if (intent === null || !shouldHandleFileClick(event)) {
        return;
      }
      event.preventDefault();
      navigation.openFilePreview(intent);
    },
    [intent, navigation, onClick],
  );
  const href =
    intent === null ? undefined : `./${encodeURIComponent(intent.target.path)}`;
  const anchor = (
    <RouteAnchor {...anchorProps} href={href} onClick={handleClick} />
  );

  if (intent === null) return anchor;
  return (
    <ContextMenu onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>{anchor}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-52">
        {isMenuOpen ? (
          <LazyExperimentalFileLinkMenu intent={intent} />
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
