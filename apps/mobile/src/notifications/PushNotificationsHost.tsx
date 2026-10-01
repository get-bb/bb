import * as Notifications from "expo-notifications";
import { getThreadRoutePath } from "@bb/client-core";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  useAppRevealed,
  useProfiles,
  useRealtimeConnectionState,
} from "@/app-shell";
import {
  parsePushNotificationData,
  resolvePushTargetProfile,
  isPushRegistrationAllowed,
  shouldOfferPushPrompt,
  type PushNotificationTarget,
} from "@/data/notifications";
import type { ServerProfile } from "@/lib/profiles";
import { ActionSheet, toast, useSheet } from "@/ui";
import { webViewShellHref } from "@/screens/shell/hrefs";
import { AppBadgeSync } from "./AppBadgeSync";
import { getPushNotificationsModule } from "./expo-push-module";
import { getPushRegistrationController } from "./push-controller";
import { getPushStore } from "./push-storage";
import { hasThreadOnServer } from "./thread-probe";
import { usePushStoreSnapshot } from "./use-push-store";

export function PushNotificationsHost() {
  const { status, profiles, activeProfile, connection } = useProfiles();
  const realtimeState = useRealtimeConnectionState();
  const connected = connection !== null && realtimeState === "connected";
  const controller = getPushRegistrationController();
  const notifications = getPushNotificationsModule();
  const storeSnapshot = usePushStoreSnapshot();
  const router = useRouter();
  const profilesRef = useRef(profiles);
  const activeProfileIdRef = useRef(activeProfile?.id ?? null);
  useEffect(() => {
    profilesRef.current = profiles;
    activeProfileIdRef.current = activeProfile?.id ?? null;
  }, [profiles, activeProfile]);

  const activeEnabled =
    activeProfile !== null &&
    storeSnapshot.enabledProfileIds.includes(activeProfile.id);

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: false,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    return () => Notifications.setNotificationHandler(null);
  }, []);

  const openTarget = useCallback(
    async (target: PushNotificationTarget) => {
      const profile = await resolvePushTargetProfile(target, {
        profiles: profilesRef.current,
        activeProfileId: activeProfileIdRef.current,
        hasThread: hasThreadOnServer,
      });
      if (!profile) {
        toast.error("Could not open the thread", {
          description: "None of your saved servers has it.",
        });
        return;
      }
      router.push(
        webViewShellHref({
          profileId: profile.id,
          path:
            target.projectId === null
              ? `/threads/${target.threadId}`
              : getThreadRoutePath({
                  projectId: target.projectId,
                  threadId: target.threadId,
                }),
        }),
      );
    },
    [router],
  );

  useEffect(() => {
    const handle = (response: Notifications.NotificationResponse) => {
      const target = parsePushNotificationData(
        response.notification.request.content.data,
      );
      if (target) void openTarget(target);
    };
    const subscription =
      Notifications.addNotificationResponseReceivedListener(handle);
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      Notifications.clearLastNotificationResponse();
      handle(last);
    }
    return () => subscription.remove();
  }, [openTarget]);

  useEffect(() => {
    if (!activeProfile || !connected) return;
    void controller.sync(activeProfile);
  }, [controller, activeProfile, connected, activeEnabled]);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== "active") return;
      void controller.refreshPermission().then(() => {
        if (activeProfile) void controller.sync(activeProfile);
      });
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [controller, activeProfile]);

  useEffect(
    () =>
      notifications.addTokenListener((deviceToken) => {
        void controller.handleTokenRolled(profilesRef.current, deviceToken);
      }),
    [controller, notifications],
  );

  useEffect(() => {
    if (status !== "ready") return;
    void controller
      .reconcileRemovedProfiles(profiles.map((p) => p.id))
      .catch((error) => {
        console.warn("Could not clean up push registrations", error);
      });
  }, [controller, status, profiles]);

  return (
    <>
      {connection ? <AppBadgeSync /> : null}
      <FirstRunPrompt
        profile={activeProfile}
        connected={connected}
        available={
          notifications.projectId !== null &&
          (activeProfile === null || isPushRegistrationAllowed(activeProfile))
        }
        prompted={storeSnapshot.prompted}
        enabled={activeEnabled}
      />
    </>
  );
}

function FirstRunPrompt({
  profile,
  connected,
  available,
  prompted,
  enabled,
}: {
  profile: ServerProfile | null;
  connected: boolean;
  available: boolean;
  prompted: boolean;
  enabled: boolean;
}) {
  const sheet = useSheet();
  const controller = getPushRegistrationController();
  const store = getPushStore();
  const notifications = getPushNotificationsModule();
  const [presentedFor, setPresentedFor] = useState<string | null>(null);
  const revealed = useAppRevealed();
  const shouldAsk =
    revealed &&
    available &&
    !prompted &&
    connected &&
    profile !== null &&
    presentedFor === null;

  useEffect(() => {
    if (!shouldAsk || !profile) return;
    let cancelled = false;
    void notifications.getPermission().then((permission) => {
      if (cancelled || !shouldOfferPushPrompt({ permission, enabled })) {
        return;
      }
      setPresentedFor(profile.id);
      sheet.present();
    });
    return () => {
      cancelled = true;
    };
  }, [shouldAsk, profile, enabled, notifications, sheet]);

  return (
    <ActionSheet
      presentation="prompt"
      controller={sheet}
      title="Get notified when a thread needs you?"
      cancelLabel={process.env.EXPO_OS === "ios" ? "Cancel" : null}
      message="bb can send a push notification when a thread finishes, hits an error, or is waiting for your input. You can change this per server in Settings."
      actions={[
        {
          key: "enable",
          label: "Turn on notifications",
          icon: "Bell",
          onPress: () => {
            if (!profile) return;
            void controller.setEnabled(profile, true).then((outcome) => {
              if (outcome.action === "failed") {
                toast.error("Could not turn on notifications", {
                  description: outcome.error,
                });
              }
            });
          },
        },
        {
          key: "later",
          label: "Not now",
          onPress: () => store.markPrompted(),
        },
      ]}
      onDismiss={() => {
        if (!store.hasPrompted()) store.markPrompted();
      }}
    />
  );
}
