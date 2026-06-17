import {
  NewTabActions,
  NewTabFileSearch,
  type NewTabFileSearchProps,
  type OpenBrowserHandler,
  type StartSideChatHandler,
  type StartTerminalHandler,
} from "./NewTabFileSearch";

type NewTabPageFileSearchProps = Omit<
  NewTabFileSearchProps,
  "idleActions"
>;

export interface NewTabPageProps extends NewTabPageFileSearchProps {
  onStartSideChat?: StartSideChatHandler;
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
  onStartSideChat,
  onStartTerminal,
  projectId,
}: NewTabPageProps) {
  return (
    <div className="flex min-h-full flex-col gap-3 px-4 pb-3 pt-1">
      <NewTabFileSearch
        projectId={projectId}
        environmentId={environmentId}
        currentThreadId={currentThreadId}
        focusRequest={focusRequest}
        idleActions={
          <NewTabActions
            onStartSideChat={onStartSideChat}
            onOpenBrowser={onOpenBrowser}
            onStartTerminal={onStartTerminal}
          />
        }
        initialQuery={initialQuery}
        onSelect={onSelect}
      />
    </div>
  );
}
