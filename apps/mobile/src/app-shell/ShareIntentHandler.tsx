import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Alert, AppState, Platform } from "react-native";
import {
  composeSeedFromShareIntent,
  loadShareIntentModule,
  type ShareIntentModule,
} from "@/lib/share";
import {
  readPendingShares,
  discardPendingShare,
  type PendingShare,
} from "@/lib/share/share-inbox";
import { forgetSharedUploadJobsForShare } from "@/lib/share/shared-upload-jobs";
import { webViewShellHref } from "@/screens/shell/hrefs";
import { toast } from "@/ui";
import { useProfiles } from "./ProfilesProvider";

export function ShareIntentHandler() {
  if (Platform.OS === "ios") return <IosShareInboxHandler />;
  const module = loadShareIntentModule();
  return module ? <LegacyShareIntentHandler module={module} /> : null;
}

function LegacyShareIntentHandler({ module }: { module: ShareIntentModule }) {
  const router = useRouter();
  const { activeProfile } = useProfiles();
  const { hasShareIntent, shareIntent, resetShareIntent, error } =
    module.useShareIntent({ resetOnBackground: true });
  useEffect(() => {
    if (error)
      toast.error("Could not read the shared content", { description: error });
  }, [error]);
  useEffect(() => {
    if (!hasShareIntent) return;
    resetShareIntent();
    if (!activeProfile) {
      toast.info("Add a server first, then share again.");
      return;
    }
    const seed = composeSeedFromShareIntent(shareIntent);
    if (!seed) {
      toast.info("Only text and links can be sent to bb for now.");
      return;
    }
    router.navigate(
      webViewShellHref({
        path: `/?initialPrompt=${encodeURIComponent(seed.initialPrompt)}`,
      }),
    );
  }, [activeProfile, hasShareIntent, resetShareIntent, router, shareIntent]);
  return null;
}

function IosShareInboxHandler() {
  const router = useRouter();
  const { status, activeProfile } = useProfiles();
  const activeProfileId = activeProfile?.id ?? null;
  const running = useRef(false);
  const queued = useRef<PendingShare[]>([]);
  const suppressedShareId = useRef<string | null>(null);
  useEffect(() => {
    function refresh() {
      if (status !== "ready" || running.current) return;
      running.current = true;
      void readPendingShares()
        .then((shares) => {
          queued.current = shares.filter(
            (share) => share.id !== suppressedShareId.current,
          );
          presentNext();
        })
        .catch((error: unknown) => {
          toast.error("Could not read pending shares", {
            description: error instanceof Error ? error.message : String(error),
          });
          running.current = false;
        });
    }

    function presentNext() {
      const share = queued.current[0];
      if (!share) {
        running.current = false;
        return;
      }
      const title = share.error
        ? "Share needs attention"
        : share.files.length === 0
          ? "Shared text or link"
          : `${share.files.length} shared file${share.files.length === 1 ? "" : "s"}`;
      const open = () => {
        queued.current.shift();
        running.current = false;
        if (!activeProfileId) {
          toast.info("Add a server to import this share.");
          return;
        }
        suppressedShareId.current = share.id;
        router.navigate(
          webViewShellHref({
            path: `/?shareId=${encodeURIComponent(share.id)}`,
          }),
        );
      };
      const discard = () => {
        void discardPendingShare(share.id)
          .then(() => {
            forgetSharedUploadJobsForShare(share.id);
            queued.current.shift();
            running.current = false;
            refresh();
          })
          .catch((error: unknown) => {
            running.current = false;
            toast.error("Could not discard this share", {
              description:
                error instanceof Error ? error.message : String(error),
            });
          });
      };
      Alert.alert("Pending share", share.error ?? title, [
        ...(!share.error ? [{ text: "Open bb", onPress: open }] : []),
        { text: "Discard", style: "destructive", onPress: discard },
        {
          text: "Later",
          style: "cancel",
          onPress: () => {
            running.current = false;
          },
        },
      ]);
    }

    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        suppressedShareId.current = null;
        refresh();
      }
    });
    return () => subscription.remove();
  }, [activeProfileId, router, status]);

  return null;
}
