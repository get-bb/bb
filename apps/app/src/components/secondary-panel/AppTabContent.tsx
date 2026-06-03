import { AppViewer } from "@/components/app-viewer/AppViewer";

export interface AppTabContentProps {
  applicationId: string;
  threadId: string;
}

/**
 * In-thread secondary-panel host for a global app. Delegates to the shared
 * {@link AppViewer}, targeting the panel's thread so the app's `message`
 * capability posts into that thread.
 */
export function AppTabContent({ applicationId, threadId }: AppTabContentProps) {
  return <AppViewer applicationId={applicationId} targetThreadId={threadId} />;
}
