import { useState } from "react";
import { useApp } from "@/hooks/queries/thread-queries";
import { useAppRoute } from "@/hooks/useAppRoute";
import { AppViewer } from "@/components/app-viewer/AppViewer";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { HttpError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { IconName } from "@/components/ui/icon.js";

// Counters the padded `<main>` so the app fills the surface edge to edge below
// the global header, matching how other full surfaces (PageShell) bleed.
const STANDALONE_SHELL_CLASS =
  "-m-4 flex h-full min-h-0 flex-1 flex-col overflow-hidden md:-m-5";

interface StandaloneAppMessageState {
  icon: IconName;
  message: string;
}

function resolveStandaloneAppErrorState(
  error: unknown,
): StandaloneAppMessageState {
  const code = error instanceof HttpError ? error.code : undefined;
  if (code === "app_missing") {
    return { icon: "FileQuestion", message: "App not found." };
  }
  if (code === "invalid_manifest") {
    return {
      icon: "AlertTriangle",
      message: "This app's manifest is invalid.",
    };
  }
  return {
    icon: "AlertTriangle",
    message: error instanceof Error ? error.message : "Failed to load app.",
  };
}

function StandaloneAppMessage({ icon, message }: StandaloneAppMessageState) {
  return (
    <div className="flex h-full flex-1 items-center justify-center p-8">
      <EmptyState icon={icon} message={message} />
    </div>
  );
}

function StandaloneAppLoading() {
  return (
    <div className="space-y-2 p-6" aria-busy>
      <Skeleton className="h-3 w-1/3 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-5/6 rounded-sm" />
      <Skeleton className="h-3 w-2/3 rounded-sm" />
    </div>
  );
}

interface StandaloneAppDeckEntryProps {
  applicationId: string;
  isActive: boolean;
}

function StandaloneAppDeckEntry({
  applicationId,
  isActive,
}: StandaloneAppDeckEntryProps) {
  const appDetail = useApp(applicationId);

  return (
    <div className={cn(isActive ? "flex min-h-0 flex-1 flex-col" : "hidden")}>
      {appDetail.isError ? (
        <StandaloneAppMessage
          {...resolveStandaloneAppErrorState(appDetail.error)}
        />
      ) : appDetail.isPending ? (
        <StandaloneAppLoading />
      ) : (
        <AppViewer applicationId={applicationId} targetThreadId={null} />
      )}
    </div>
  );
}

/**
 * Standalone, thread-independent surface for a global app at
 * `/apps/:applicationId`. The app name is shown in the global header (see
 * AppLayout); this view owns the missing/invalid/loading states and delegates
 * the rendered app to the shared {@link AppViewer}. Deep-linking here loads the
 * app with no thread or project context.
 *
 * Mirrors BrowserTabDeck: every app visited while this route is mounted stays
 * mounted (its iframe keeps its document and state), and switching app pages
 * is a visibility toggle rather than a destroy/recreate + cold boot. Route
 * param changes don't remount this element, so the deck survives app→app
 * navigation; leaving for a non-app route unmounts everything — unlike the
 * browser deck's native views, an iframe can't outlive its DOM node. The
 * retained set is bounded by the installed-apps list, so there's no eviction.
 */
export function StandaloneAppView() {
  const { applicationId } = useAppRoute();
  const [visitedAppIds, setVisitedAppIds] = useState<readonly string[]>([]);

  // Adjust-state-during-render (not an effect) so the first render of a newly
  // visited app already includes its deck entry — an effect would flash an
  // empty deck for one frame.
  if (applicationId !== undefined && !visitedAppIds.includes(applicationId)) {
    setVisitedAppIds([...visitedAppIds, applicationId]);
  }

  if (applicationId === undefined) {
    return (
      <div className={STANDALONE_SHELL_CLASS}>
        <StandaloneAppMessage icon="FileQuestion" message="App not found." />
      </div>
    );
  }

  return (
    <div className={STANDALONE_SHELL_CLASS}>
      {visitedAppIds.map((visitedAppId) => (
        <StandaloneAppDeckEntry
          key={visitedAppId}
          applicationId={visitedAppId}
          isActive={visitedAppId === applicationId}
        />
      ))}
    </div>
  );
}
