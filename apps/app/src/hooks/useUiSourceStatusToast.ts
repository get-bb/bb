import { useEffect, useRef } from "react";
import { appToast } from "@/components/ui/app-toast";
import { useUiSourceStatus } from "./queries/ui-source-queries";

const ERROR_TOAST_ID = "bb-ui-source-error";
const REBASE_TOAST_ID = "bb-ui-source-rebase";

/**
 * Surface UI-source problems in the app so a user who didn't run `bb ui ...`
 * still sees them. A build failure (the live UI stayed on the last good build)
 * or a rebase-needed state (the shipped UI is active until resolved) shows a
 * persistent toast; healthy states clear it. The status query is invalidated by
 * the `ui-status-changed` realtime signal, so this reacts without a reload.
 */
export function useUiSourceStatusToast(): void {
  const { data } = useUiSourceStatus();
  const shownRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data || !data.enabled) {
      return;
    }

    if (data.status === "error") {
      const key = `error:${data.error ?? ""}`;
      if (shownRef.current === key) {
        return;
      }
      shownRef.current = key;
      appToast.message("UI build failed", {
        id: ERROR_TOAST_ID,
        description:
          data.error ??
          "The UI fork build failed. The previous UI is still running.",
        duration: Infinity,
        action: {
          label: "Switch to shipped",
          onClick: () => {
            void fetch("/api/v1/ui/prod", { method: "POST" }).catch(
              () => undefined,
            );
            appToast.dismiss(ERROR_TOAST_ID);
          },
        },
      });
      return;
    }

    if (data.status === "needs-rebase") {
      if (shownRef.current === "needs-rebase") {
        return;
      }
      shownRef.current = "needs-rebase";
      appToast.message("UI update needs rebase", {
        id: REBASE_TOAST_ID,
        description:
          "A bb update conflicts with your UI edits. The shipped UI is active " +
          "until an agent resolves the rebase (bb ui update --continue).",
        duration: Infinity,
      });
      return;
    }

    // Healthy state — clear any problem toast we previously showed.
    if (shownRef.current !== null) {
      appToast.dismiss(ERROR_TOAST_ID);
      appToast.dismiss(REBASE_TOAST_ID);
      shownRef.current = null;
    }
  }, [data]);
}
