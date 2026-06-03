import { useApp } from "@/hooks/queries/thread-queries";
import { useAppRoute } from "@/hooks/useAppRoute";
import { AppViewer } from "@/components/app-viewer/AppViewer";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { HttpError } from "@/lib/api";
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

/**
 * Standalone, thread-independent surface for a global app at
 * `/apps/:applicationId`. The app name is shown in the global header (see
 * AppLayout); this view owns the missing/invalid/loading states and delegates
 * the rendered app to the shared {@link AppViewer}. Deep-linking here loads the
 * app with no thread or project context.
 */
export function StandaloneAppView() {
  const { applicationId } = useAppRoute();
  const appDetail = useApp(applicationId);

  if (applicationId === undefined) {
    return (
      <div className={STANDALONE_SHELL_CLASS}>
        <StandaloneAppMessage icon="FileQuestion" message="App not found." />
      </div>
    );
  }

  return (
    <div className={STANDALONE_SHELL_CLASS}>
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
