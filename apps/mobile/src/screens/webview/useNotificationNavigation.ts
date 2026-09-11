import {
  useFocusEffect,
  useNavigation,
  type NativeStackNavigationProp,
} from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  finishNotificationNavigation,
  setNotificationNavigationReady,
} from "@/notifications/notification-navigation";

export function useNotificationNavigation(
  notificationId: string | undefined,
  ready: boolean,
  failed: boolean,
): void {
  const navigation =
    useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const [focused, setFocused] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const start = navigation.addListener("transitionStart", () => {
      setSettled(false);
    });
    const end = navigation.addListener("transitionEnd", ({ data }) => {
      setSettled(!data.closing);
    });
    return () => {
      start();
      end();
    };
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        if (notificationId) {
          finishNotificationNavigation(notificationId, "cancelled");
        }
      };
    }, [notificationId]),
  );

  useEffect(() => {
    if (!notificationId || !focused) return;
    if (failed) {
      finishNotificationNavigation(notificationId, "cancelled");
      return;
    }
    setNotificationNavigationReady(notificationId, ready && settled);
    return () => setNotificationNavigationReady(notificationId, false);
  }, [failed, focused, notificationId, ready, settled]);
}
