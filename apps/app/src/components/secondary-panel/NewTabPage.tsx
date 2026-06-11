import { useState } from "react";
import {
  NewTabActions,
  NewTabFileSearch,
  type NewTabFileSearchProps,
  type OpenBrowserHandler,
  type StartTerminalHandler,
} from "./NewTabFileSearch";

type NewTabPageFileSearchProps = Omit<
  NewTabFileSearchProps,
  "onSearchActiveChange"
>;

export interface NewTabPageProps extends NewTabPageFileSearchProps {
  onOpenBrowser?: OpenBrowserHandler;
  onStartTerminal?: StartTerminalHandler;
}

/**
 * Browser-style "New Tab" landing page for the secondary panel. The tab body
 * keeps file search primary while secondary commands live in-page, avoiding
 * overlays that can be occluded by native browser/webview surfaces.
 */
export function NewTabPage({
  currentThreadId,
  environmentId,
  focusRequest,
  initialQuery,
  onOpenBrowser,
  onSelect,
  onStartTerminal,
  projectId,
}: NewTabPageProps) {
  const [isSearchActive, setIsSearchActive] = useState(
    () => (initialQuery ?? "").trim().length > 0,
  );

  return (
    <div className="flex min-h-full flex-col gap-3 px-4 pb-3 pt-1">
      <NewTabFileSearch
        projectId={projectId}
        environmentId={environmentId}
        currentThreadId={currentThreadId}
        focusRequest={focusRequest}
        initialQuery={initialQuery}
        onSearchActiveChange={setIsSearchActive}
        onSelect={onSelect}
      />
      {isSearchActive ? null : (
        <NewTabActions
          onOpenBrowser={onOpenBrowser}
          onStartTerminal={onStartTerminal}
        />
      )}
    </div>
  );
}
