import * as Notifications from "expo-notifications";
import { getThreadRoutePath } from "@bb/client-core";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useProfiles, useRealtimeConnectionState } from "@/app-shell";
import {
  parsePushNotificationData,
  resolvePushTargetProfile,
  isPushRegistrationAllowed,
  type PushNotificationTarget,
  type PushSyncProfile,
} from "@/data/notifications";
import type { ServerProfile } from "@/lib/profiles";
import { ActionSheet, toast, useSheet } from "@/ui";
import type { ToastOptions } from "@/ui/Toast";
import { webViewShellHref } from "@/screens/shell/hrefs";
import { AppBadgeSync } from "./AppBadgeSync";
import { getPushNotificationsModule } from "./expo-push-module";
import { getPushRegistrationController } from "./push-controller";
import { getPushStore } from "./push-storage";
import { hasThreadOnServer } from "./thread-probe";
import { usePushStoreSnapshot } from "./use-push-store";
import { watchNotificationNavigation } from "./notification-navigation";

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

  const syncProfile = useMemo<PushSyncProfile | null>(
    () =>
      activeProfile
        ? {
            id: activeProfile.id,
            serverUrl: activeProfile.serverUrl,
            mode: activeProfile.mode,
          }
        : null,
    [activeProfile],
  );
  const activeEnabled =
    syncProfile !== null &&
    storeSnapshot.enabledProfileIds.includes(syncProfile.id);

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
    async (target: PushNotificationTarget, notificationId?: string) => {
      const profile = await resolvePushTargetProfile(target, {
        profiles: profilesRef.current,
        activeProfileId: activeProfileIdRef.current,
        hasThread: hasThreadOnServer,
      });
      if (!profile) {
        toast.error("Could not open the thread", {
          description: "None of your saved servers has it.",
          duration: 2_000,
          overlay: true,
        });
        return false;
      }
      router.push(
        webViewShellHref({
          profileId: profile.id,
          notificationId,
          path:
            target.projectId === null
              ? `/threads/${target.threadId}`
              : getThreadRoutePath({
                  projectId: target.projectId,
                  threadId: target.threadId,
                }),
        }),
      );
      return true;
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
    const pending = new Set<() => void>();
    const subscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        const content = notification.request.content;
        const target = parsePushNotificationData(content.data);
        if (!target) return;
        let opening = false;
        let attempt = 0;
        let dismissed = false;
        let stopWaiting: (() => void) | undefined;
        const title = content.title ?? "bb";
        const options: ToastOptions = {
          description: content.body ?? undefined,
          duration: 8_000,
          onDismiss: () => {
            dismissed = true;
            stopWaiting?.();
          },
          action: {
            label: "Open",
            onClick: async () => {
              if (opening) return;
              opening = true;
              toast.message(title, {
                ...options,
                id: toastId,
                duration: Infinity,
              });
              const notificationId = `${toastId}:${++attempt}`;
              const stop = watchNotificationNavigation(
                notificationId,
                (outcome) => {
                  pending.delete(stop);
                  if (outcome === "ready") {
                    toast.dismiss(toastId);
                  } else {
                    toast.message(title, { ...options, id: toastId });
                    opening = false;
                  }
                },
              );
              stopWaiting = () => {
                stop();
                pending.delete(stop);
              };
              pending.add(stop);
              if (!(await openTarget(target, notificationId))) {
                stop();
                pending.delete(stop);
                if (!dismissed) toast.message(title, { ...options, id: toastId });
                opening = false;
                return;
              }
            },
          },
        };
        const toastId = toast.message(title, options);
      },
    );
    return () => {
      subscription.remove();
      for (const stop of pending) stop();
    };
  }, [openTarget]);

  useEffect(() => {
    if (!syncProfile || !connected) return;
    void controller.sync(syncProfile);
  }, [controller, syncProfile, connected, activeEnabled]);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== "active") return;
      void controller.refreshPermission().then(() => {
        if (syncProfile) void controller.sync(syncProfile);
      });
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [controller, syncProfile]);

  useEffect(
    () =>
      notifications.addTokenListener((deviceToken) => {
        void controller.handleTokenRolled(
          profilesRef.current.map((profile) => ({
            id: profile.id,
            serverUrl: profile.serverUrl,
            mode: profile.mode,
          })),
          deviceToken,
        );
      }),
    [controller, notifications],
  );

  useEffect(() => {
    if (status !== "ready") return;
    void controller.reconcileRemovedProfiles(profiles.map((p) => p.id));
  }, [controller, status, profiles]);

  return (
    <>
      {connection ? <AppBadgeSync /> : null}
      <FirstRunPrompt
        profile={activeProfile}
        connected={connected}
        available={
          notifications.projectId !== null &&
          (syncProfile === null || isPushRegistrationAllowed(syncProfile))
        }
        prompted={storeSnapshot.prompted}
      />
    </>
  );
}

function FirstRunPrompt({
  profile,
  connected,
  available,
  prompted,
}: {
  profile: ServerProfile | null;
  connected: boolean;
  available: boolean;
  prompted: boolean;
}) {
  const sheet = useSheet();
  const controller = getPushRegistrationController();
  const store = getPushStore();
  const notifications = getPushNotificationsModule();
  const [presentedFor, setPresentedFor] = useState<string | null>(null);
  const shouldAsk =
    available &&
    !prompted &&
    connected &&
    profile !== null &&
    presentedFor === null;

  useEffect(() => {
    if (!shouldAsk || !profile) return;
    let cancelled = false;
    void notifications.getPermission().then((permission) => {
      if (cancelled || permission !== "undetermined") return;
      setPresentedFor(profile.id);
      sheet.present();
    });
    return () => {
      cancelled = true;
    };
  }, [shouldAsk, profile, notifications, sheet]);

  const target = useMemo(
    () =>
      profile
        ? {
            id: profile.id,
            serverUrl: profile.serverUrl,
            mode: profile.mode,
          }
        : null,
    [profile],
  );

  return (
    <ActionSheet
      controller={sheet}
      title="Get notified when a thread needs you?"
      message="bb can send a push notification when a thread finishes, hits an error, or is waiting for your input. You can change this per server in Settings."
      actions={[
        {
          key: "enable",
          label: "Turn on notifications",
          icon: "Zap",
          onPress: () => {
            if (!target) return;
            void controller.setEnabled(target, true).then((outcome) => {
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
