import { useNewTabActions, type UseNewTabActionsArgs } from "./NewTabActions";
import {
  NewTabFileSearch,
  type NewTabFileSearchProps,
} from "./NewTabFileSearch";

type NewTabPageFileSearchProps = Omit<NewTabFileSearchProps, "actions">;

type NewTabPageProps = NewTabPageFileSearchProps & UseNewTabActionsArgs;

export function NewTabPage({
  autoFocus,
  currentThreadId,
  environmentId,
  hostId,
  initialQuery,
  onAutoFocusHandled,
  onOpenBrowser,
  onSelect,
  onStartTerminal,
  pluginActions,
  projectId,
  recentItemsThreadId,
  showFileSearch,
  startTerminalDisabled,
  startTerminalTrailing,
}: NewTabPageProps) {
  const actions = useNewTabActions({
    onOpenBrowser,
    onStartTerminal,
    pluginActions,
    startTerminalDisabled,
    startTerminalTrailing,
  });

  return (
    <div
      data-panel-new-tab-page=""
      className="flex min-h-full flex-col gap-3 bg-sidebar px-4 pb-3 pt-1"
    >
      <NewTabFileSearch
        projectId={projectId}
        environmentId={environmentId}
        hostId={hostId}
        currentThreadId={currentThreadId}
        autoFocus={autoFocus}
        actions={actions}
        initialQuery={initialQuery}
        onAutoFocusHandled={onAutoFocusHandled}
        onSelect={onSelect}
        recentItemsThreadId={recentItemsThreadId}
        showFileSearch={showFileSearch}
      />
    </div>
  );
}
